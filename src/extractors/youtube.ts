import { logProgress, logError } from "../utils/log";
import { spin } from "../utils/spinner";
import { extractYouTubeId } from "../utils/url";
import { hasCommand } from "../utils/deps";
import { stripVttTimestamps, parseChapters, type Chapter } from "../utils/vtt";
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
  lang: string = "en"
): Promise<YouTubeResult> {
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    throw new Error(`Could not extract YouTube video ID from: ${url}`);
  }

  await ensureYtDlp();

  let s = spin("Fetching video metadata...");
  const metadata = await fetchMetadata(url);
  s.stop("Metadata fetched");

  s = spin("Downloading captions...");
  let transcript = await fetchCaptions(url, videoId, lang);
  s.stop(transcript ? "Captions downloaded" : "No captions found");

  if (!transcript) {
    logProgress("Attempting audio transcription fallback...");
    transcript = await whisperFallback(url, videoId);
  }

  if (!transcript) {
    throw new Error(
      `No captions available for this video in language "${lang}". ` +
        `Try a different language with --lang, or the video may not have subtitles.\n` +
        `Install whisper.cpp to enable audio transcription fallback:\n` +
        `  brew install whisper-cpp`
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

async function ensureYtDlp(): Promise<void> {
  const proc = Bun.spawn(["which", "yt-dlp"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(
      "yt-dlp is not installed. Install it with:\n" +
        "  brew install yt-dlp\n" +
        "  # or: pip install yt-dlp\n" +
        "  # or: https://github.com/yt-dlp/yt-dlp#installation"
    );
  }
}

async function fetchMetadata(url: string): Promise<Record<string, any>> {
  const proc = Bun.spawn(
    ["yt-dlp", "--dump-json", "--no-download", url],
    { stdout: "pipe", stderr: "pipe" }
  );

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `yt-dlp failed to fetch metadata: ${stderr.trim() || "unknown error"}`
    );
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
  lang: string
): Promise<string | null> {
  const workDir = join(tmpdir(), `extractor-yt-${videoId}`);
  await Bun.write(join(workDir, ".keep"), "");

  try {
    const proc = Bun.spawn(
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
      { stdout: "pipe", stderr: "pipe" }
    );

    await proc.exited;

    const files = await readdir(workDir);
    const vttFile = files.find((f) => f.endsWith(".vtt"));

    if (!vttFile) return null;

    const vttContent = await readFile(join(workDir, vttFile), "utf-8");
    return stripVttTimestamps(vttContent);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function whisperFallback(
  url: string,
  videoId: string
): Promise<string | null> {
  const whisperAvailable = await hasCommand("whisper-cpp");
  if (!whisperAvailable) {
    logError("whisper-cpp not found — cannot transcribe audio");
    return null;
  }

  const model = await findWhisperModel();
  if (!model) {
    logError(
      "No whisper model found. Set WHISPER_MODEL env var or install a model:\n" +
        "  brew install whisper-cpp && whisper-cpp --download-model base.en"
    );
    return null;
  }

  const workDir = join(tmpdir(), `extractor-whisper-${videoId}`);
  await Bun.write(join(workDir, ".keep"), "");

  try {
    const audioPath = await downloadAudio(url, workDir);
    if (!audioPath) return null;

    return await transcribeWithWhisper(audioPath, model);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadAudio(
  url: string,
  workDir: string
): Promise<string | null> {
  const s = spin("Downloading audio for transcription...");
  const proc = Bun.spawn(
    [
      "yt-dlp",
      "--extract-audio",
      "--audio-format",
      "wav",
      "-o",
      join(workDir, "audio.%(ext)s"),
      url,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    s.stop("Audio download failed");
    const stderr = await new Response(proc.stderr).text();
    logError(`Failed to download audio: ${stderr.trim() || "unknown error"}`);
    return null;
  }
  s.stop("Audio downloaded");

  const files = await readdir(workDir);
  const wavFile = files.find((f) => f.endsWith(".wav"));
  return wavFile ? join(workDir, wavFile) : null;
}

async function transcribeWithWhisper(
  audioPath: string,
  modelPath: string
): Promise<string | null> {
  const s = spin("Transcribing audio with whisper.cpp...");
  const proc = Bun.spawn(
    ["whisper-cpp", "-m", modelPath, "-f", audioPath, "--no-timestamps"],
    { stdout: "pipe", stderr: "pipe" }
  );

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    s.stop("Transcription failed");
    const stderr = await new Response(proc.stderr).text();
    logError(`whisper-cpp failed: ${stderr.trim() || "unknown error"}`);
    return null;
  }
  s.stop("Audio transcribed");

  const text = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n\n");

  return text || null;
}

export async function findWhisperModel(): Promise<string | null> {
  const envModel = process.env.WHISPER_MODEL;
  if (envModel) {
    const file = Bun.file(envModel);
    if (await file.exists()) return envModel;
  }

  const home = process.env.HOME || "";
  const candidates = [
    "/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin",
    "/usr/local/share/whisper-cpp/models/ggml-base.en.bin",
    join(home, ".cache/whisper/ggml-base.en.bin"),
    join(home, ".local/share/whisper-cpp/models/ggml-base.en.bin"),
  ];

  for (const path of candidates) {
    const file = Bun.file(path);
    if (await file.exists()) return path;
  }

  return null;
}
