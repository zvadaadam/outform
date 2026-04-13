import { logProgress, logError, type ExtractLogger } from "../utils/log";
import { spin } from "../utils/spinner";
import { extractYouTubeId } from "../utils/url";
import { hasCommand } from "../utils/deps";
import { stripVttTimestamps, parseChapters, type Chapter } from "../utils/vtt";
import { missingDependencyIssue, ExtractorError } from "../errors";
import { spawn, collectText, fileExists, writeWithDirs } from "../utils/process";
import { tmpdir } from "os";
import { join } from "path";
import { readdir, readFile, rm } from "fs/promises";

export interface YouTubeResult {
  title: string;
  channel: string;
  description: string;
  source: string;
  duration: number | null;
  chapters: Chapter[] | null;
  transcript: string;
}

export async function extractYouTube(
  url: string,
  lang: string = "en",
  logger?: ExtractLogger,
): Promise<YouTubeResult> {
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
  const proc = spawn(["which", "yt-dlp"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new ExtractorError(
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

  const output = await collectText(proc.stdout);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await collectText(proc.stderr);
    throw new Error(`yt-dlp failed to fetch metadata: ${stderr.trim() || "unknown error"}`);
  }

  try {
    return JSON.parse(output);
  } catch {
    throw new Error("Failed to parse yt-dlp metadata output as JSON");
  }
}

async function fetchCaptions(
  url: string,
  videoId: string,
  lang: string,
): Promise<string | null> {
  const workDir = join(tmpdir(), `extractor-yt-${videoId}`);
  await writeWithDirs(join(workDir, ".keep"), "");

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

    await proc.exited;

    const files = await readdir(workDir);
    const vttFile = files.find((file) => file.endsWith(".vtt"));

    if (!vttFile) return null;

    const vttContent = await readFile(join(workDir, vttFile), "utf-8");
    return stripVttTimestamps(vttContent);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function whisperFallback(
  url: string,
  videoId: string,
  logger?: ExtractLogger,
): Promise<string | null> {
  const whisperAvailable = await hasCommand("whisper-cpp");
  if (!whisperAvailable) {
    logError("whisper-cpp not found — cannot transcribe audio", logger);
    return null;
  }

  const model = await findWhisperModel();
  if (!model) {
    logError(
      "No whisper model found. Set WHISPER_MODEL env var or install a model:\n" +
        "  brew install whisper-cpp && whisper-cpp --download-model base.en",
      logger,
    );
    return null;
  }

  const workDir = join(tmpdir(), `extractor-whisper-${videoId}`);
  await writeWithDirs(join(workDir, ".keep"), "");

  try {
    const audioPath = await downloadAudio(url, workDir, logger);
    if (!audioPath) return null;

    return await transcribeWithWhisper(audioPath, model, logger);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadAudio(
  url: string,
  workDir: string,
  logger?: ExtractLogger,
): Promise<string | null> {
  const s = spin("Downloading audio for transcription...", logger);
  const proc = spawn(
    [
      "yt-dlp",
      "--extract-audio",
      "--audio-format",
      "wav",
      "-o",
      join(workDir, "audio.%(ext)s"),
      url,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    s.stop("Audio download failed");
    const stderr = await collectText(proc.stderr);
    logError(`Failed to download audio: ${stderr.trim() || "unknown error"}`, logger);
    return null;
  }
  s.stop("Audio downloaded");

  const files = await readdir(workDir);
  const wavFile = files.find((file) => file.endsWith(".wav"));
  return wavFile ? join(workDir, wavFile) : null;
}

async function transcribeWithWhisper(
  audioPath: string,
  modelPath: string,
  logger?: ExtractLogger,
): Promise<string | null> {
  const s = spin("Transcribing audio with whisper.cpp...", logger);
  const proc = spawn(["whisper-cpp", "-m", modelPath, "-f", audioPath, "--no-timestamps"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await collectText(proc.stdout);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    s.stop("Transcription failed");
    const stderr = await collectText(proc.stderr);
    logError(`whisper-cpp failed: ${stderr.trim() || "unknown error"}`, logger);
    return null;
  }
  s.stop("Audio transcribed");

  const text = output
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
