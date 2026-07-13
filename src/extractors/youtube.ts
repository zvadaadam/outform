import { logProgress, logError, type ExtractLogger } from "../utils/log";
import { spin } from "../utils/spinner";
import { extractYouTubeId } from "../utils/url";
import { hasCommand } from "../utils/deps";
import { stripVttTimestamps, parseChapters, type Chapter } from "../utils/vtt";
import { missingDependencyIssue, OutformError } from "../errors";
import { spawn, waitForResult, fileExists } from "../utils/process";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtemp, readdir, readFile, rm } from "fs/promises";

const WHISPER_COMMANDS = ["whisper-cpp", "whisper-cli"];

export interface YouTubeResult {
  title: string;
  channel: string;
  description: string;
  source: string;
  duration: number | null;
  chapters: Chapter[] | null;
  transcript: string;
}

export async function extractYouTube(url: string, lang: string = "en", logger?: ExtractLogger): Promise<YouTubeResult> {
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    throw new Error(`Could not extract YouTube video ID from: ${url}`);
  }

  await ensureYtDlp(url);

  let s = spin("Fetching video metadata...", logger);
  const metadata = await fetchMetadata(url);
  s.stop("Metadata fetched");

  s = spin("Downloading captions...", logger);
  let transcript = await fetchCaptions(url, videoId, lang);
  s.stop(transcript ? "Captions downloaded" : "No captions found");

  if (!transcript) {
    logProgress("Attempting audio transcription fallback...", logger);
    transcript = await whisperFallback(url, videoId, logger);
  }

  if (!transcript) {
    throw new Error(
      `No captions available for this video in language "${lang}". ` +
        `Try a different language with --lang, or the video may not have subtitles.\n` +
        `Install whisper.cpp to enable audio transcription fallback:\n` +
        `  brew install whisper-cpp`,
    );
  }

  const chapters = parseChapters(metadata);

  return {
    title: metadata.title || metadata.fulltitle || "Untitled Video",
    channel: metadata.channel || metadata.uploader || "Unknown",
    description: metadata.description || "",
    source: `https://www.youtube.com/watch?v=${videoId}`,
    duration: metadata.duration ?? null,
    chapters,
    transcript,
  };
}

async function ensureYtDlp(url: string): Promise<void> {
  if (!(await hasCommand("yt-dlp"))) {
    throw new OutformError(
      missingDependencyIssue({
        url,
        urlType: "youtube",
        capability: "youtube",
        dependency: "yt-dlp",
        setupTarget: "youtube",
        installHints: ["brew install yt-dlp", "pip install yt-dlp"],
        message:
          "yt-dlp is not installed. Install it with:\n" +
          "  brew install yt-dlp\n" +
          "  # or: pip install yt-dlp\n" +
          "  # or: https://github.com/yt-dlp/yt-dlp#installation",
      }),
    );
  }
}

async function fetchMetadata(url: string): Promise<Record<string, any>> {
  const proc = spawn(["yt-dlp", "--dump-json", "--no-download", url], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const { stdout, stderr, exitCode } = await waitForResult(proc);

  if (exitCode !== 0) {
    throw new Error(`yt-dlp failed to fetch metadata: ${stderr.trim() || "unknown error"}`);
  }

  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("Failed to parse yt-dlp metadata output as JSON");
  }
}

async function fetchCaptions(url: string, videoId: string, lang: string): Promise<string | null> {
  const workDir = await mkdtemp(join(tmpdir(), `outform-yt-${videoId}-`));

  try {
    const proc = spawn(
      [
        "yt-dlp",
        "--write-sub",
        "--write-auto-sub",
        "--sub-lang",
        lang,
        "--sub-format",
        "vtt",
        "--skip-download",
        "--no-overwrites",
        "-o",
        join(workDir, "%(id)s"),
        url,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    await waitForResult(proc);

    const files = await readdir(workDir);
    const vttFile = files.find((file) => file.endsWith(".vtt"));

    if (!vttFile) return null;

    const vttContent = await readFile(join(workDir, vttFile), "utf-8");
    return stripVttTimestamps(vttContent);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function whisperFallback(url: string, videoId: string, logger?: ExtractLogger): Promise<string | null> {
  const whisperCommand = await resolveWhisperCommand();
  if (!whisperCommand) {
    logError("whisper-cpp not found — cannot transcribe audio", logger);
    return null;
  }

  const model = await findWhisperModel();
  if (!model) {
    logError(
      "No whisper model found. Set WHISPER_MODEL env var or install a model:\n" +
        "  brew install whisper-cpp\n" +
        "  export WHISPER_MODEL=/path/to/ggml-base.en.bin",
      logger,
    );
    return null;
  }

  const workDir = await mkdtemp(join(tmpdir(), `outform-whisper-${videoId}-`));

  try {
    const audioPath = await downloadAudio(url, workDir, logger);
    if (!audioPath) return null;

    return await transcribeWithWhisper(whisperCommand, audioPath, model, logger);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function resolveWhisperCommand(): Promise<string | null> {
  for (const command of WHISPER_COMMANDS) {
    if (await hasCommand(command)) {
      return command;
    }
  }

  return null;
}

async function downloadAudio(url: string, workDir: string, logger?: ExtractLogger): Promise<string | null> {
  const s = spin("Downloading audio for transcription...", logger);
  const proc = spawn(
    ["yt-dlp", "--extract-audio", "--audio-format", "wav", "-o", join(workDir, "audio.%(ext)s"), url],
    { stdout: "pipe", stderr: "pipe" },
  );

  const { exitCode, stderr } = await waitForResult(proc);
  if (exitCode !== 0) {
    s.stop("Audio download failed");
    logError(`Failed to download audio: ${stderr.trim() || "unknown error"}`, logger);
    return null;
  }
  s.stop("Audio downloaded");

  const files = await readdir(workDir);
  const wavFile = files.find((file) => file.endsWith(".wav"));
  return wavFile ? join(workDir, wavFile) : null;
}

async function transcribeWithWhisper(
  command: string,
  audioPath: string,
  modelPath: string,
  logger?: ExtractLogger,
): Promise<string | null> {
  const s = spin("Transcribing audio with whisper.cpp...", logger);
  const proc = spawn([command, "-m", modelPath, "-f", audioPath, "--no-timestamps"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const { stdout, stderr, exitCode } = await waitForResult(proc);

  if (exitCode !== 0) {
    s.stop("Transcription failed");
    logError(`whisper-cpp failed: ${stderr.trim() || "unknown error"}`, logger);
    return null;
  }
  s.stop("Audio transcribed");

  const text = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n\n");

  return text || null;
}

export async function findWhisperModel(): Promise<string | null> {
  const envModel = process.env.WHISPER_MODEL;
  if (envModel) {
    if (await fileExists(envModel)) return envModel;
  }

  const home = process.env.HOME || "";
  const candidates = [
    "/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin",
    "/usr/local/share/whisper-cpp/models/ggml-base.en.bin",
    join(home, ".cache/whisper/ggml-base.en.bin"),
    join(home, ".local/share/whisper-cpp/models/ggml-base.en.bin"),
  ];

  for (const path of candidates) {
    if (await fileExists(path)) return path;
  }

  return null;
}
