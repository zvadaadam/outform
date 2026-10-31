import { logProgress, logError, type ExtractLogger } from "../utils/log";
import { spin } from "../utils/spinner";
import { extractYouTubeId } from "../utils/url";
import { findWhisperModel, hasCommand, installHintsFor } from "../utils/deps";
import {
  parseTranscriptSegments,
  parseWhisperSegments,
  transcriptText,
  parseChapters,
  type Chapter,
  type TranscriptSegment,
} from "../utils/vtt";
import { missingDependencyIssue, OutformError, type OutformIssue } from "../errors";
import { spawn, waitForResult, toolPath } from "../utils/process";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { mkdtemp, readdir, readFile, rm } from "fs/promises";

export { findWhisperModel } from "../utils/deps";

function ytDlpCommand(args: string[], audio = false): string[] {
  return [
    "yt-dlp",
    "--ignore-config",
    "--no-playlist",
    "--no-js-runtimes",
    "--js-runtimes",
    `deno:${toolPath("deno")}`,
    ...(audio ? ["--ffmpeg-location", dirname(toolPath("ffmpeg"))] : []),
    ...args,
  ];
}

export interface YouTubeMetadata {
  videoId: string;
  author: string | null;
  channelId: string | null;
  channelUrl: string | null;
  thumbnail: string | null;
  uploadDate: string | null;
  title: string;
  channel: string;
  description: string;
  source: string;
  duration: number | null;
}

export interface YouTubeResult extends YouTubeMetadata {
  chapters: Chapter[] | null;
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  transcriptSource: "captions" | "whisper" | null;
  chaptersSource: "source" | "generated" | null;
  issues: OutformIssue[];
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
  let segments = await fetchCaptions(url, videoId, lang);
  let transcriptSource: YouTubeResult["transcriptSource"] = segments?.length ? "captions" : null;
  const issues: OutformIssue[] = [];
  s.stop(segments?.length ? "Captions downloaded" : "No captions found");

  if (!segments?.length) {
    logProgress("Attempting audio transcription fallback...", logger);
    try {
      segments = await whisperFallback(url, videoId, logger);
      if (segments?.length) transcriptSource = "whisper";
    } catch (error) {
      logError(`Transcription failed: ${error instanceof Error ? error.message : String(error)}`, logger);
    }
  }
  if (!segments?.length) {
    const issue: OutformIssue = {
      code: "TRANSCRIPT_UNAVAILABLE",
      capability: "transcription",
      url,
      urlType: "youtube",
      message: `No transcript is available in language "${lang}". Metadata and source chapters are still included.`,
      setupCommand: "outform install whisper",
    };
    issues.push(issue);
    logError(`${issue.message} Run outform install whisper to prepare transcription.`, logger);
  }

  const chapters = parseChapters(metadata);

  return {
    ...parseYouTubeMetadata(metadata, videoId),
    chapters,
    transcript: transcriptText(segments ?? []),
    transcriptSegments: segments ?? [],
    transcriptSource,
    chaptersSource: chapters ? "source" : null,
    issues,
  };
}

async function ensureYtDlp(url: string): Promise<void> {
  if (!(await hasCommand("yt-dlp"))) {
    const hints = installHintsFor("youtube");
    throw new OutformError(
      missingDependencyIssue({
        url,
        urlType: "youtube",
        capability: "youtube",
        dependency: "yt-dlp",
        setupTarget: "youtube",
        installHints: hints,
        message:
          "yt-dlp is not installed. Run `outform install youtube` to install it automatically, or use:\n" +
          hints.map((hint) => `  ${hint}`).join("\n"),
      }),
    );
  }
}

function metadataText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function metadataUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function uploadDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) return null;
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function thumbnailUrl(metadata: Record<string, unknown>): string | null {
  const preferred = metadataUrl(metadata.thumbnail);
  if (preferred) return preferred;
  if (!Array.isArray(metadata.thumbnails)) return null;
  let best: { url: string; area: number } | null = null;
  for (const thumbnail of metadata.thumbnails) {
    if (!thumbnail || typeof thumbnail !== "object") continue;
    const url = metadataUrl(thumbnail.url);
    if (!url) continue;
    const area = [thumbnail.width, thumbnail.height].every(
      (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
    )
      ? thumbnail.width * thumbnail.height
      : 0;
    if (!best || area >= best.area) best = { url, area };
  }
  return best?.url ?? null;
}

export function parseYouTubeMetadata(metadata: Record<string, unknown>, videoId: string): YouTubeMetadata {
  const author = metadataText(metadata.channel).trim() || metadataText(metadata.uploader).trim() || null;
  return {
    videoId,
    title: metadataText(metadata.title).trim() || metadataText(metadata.fulltitle).trim() || "Untitled Video",
    author,
    channel: author ?? "Unknown",
    channelId: metadataText(metadata.channel_id).trim() || null,
    channelUrl: metadataUrl(metadata.channel_url) ?? metadataUrl(metadata.uploader_url),
    thumbnail: thumbnailUrl(metadata),
    uploadDate: uploadDate(metadata.upload_date),
    description: metadataText(metadata.description),
    source: `https://www.youtube.com/watch?v=${videoId}`,
    duration:
      typeof metadata.duration === "number" && Number.isFinite(metadata.duration) && metadata.duration >= 0
        ? metadata.duration
        : null,
  };
}

async function fetchMetadata(url: string): Promise<Record<string, unknown>> {
  const proc = spawn(ytDlpCommand(["--dump-json", "--no-download", url]), {
    stdout: "pipe",
    stderr: "pipe",
  });

  const { stdout, stderr, exitCode } = await waitForResult(proc);

  if (exitCode !== 0) {
    throw new Error(`yt-dlp failed to fetch metadata: ${stderr.trim() || "unknown error"}`);
  }

  try {
    const metadata: unknown = JSON.parse(stdout);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
      throw new Error("Expected video metadata object");
    return metadata as Record<string, unknown>;
  } catch {
    throw new Error("Failed to parse yt-dlp metadata output as JSON");
  }
}

async function fetchCaptions(url: string, videoId: string, lang: string): Promise<TranscriptSegment[] | null> {
  const workDir = await mkdtemp(join(tmpdir(), `outform-yt-${videoId}-`));

  try {
    const proc = spawn(
      ytDlpCommand([
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
      ]),
      { stdout: "pipe", stderr: "pipe" },
    );

    await waitForResult(proc);

    const files = await readdir(workDir);
    const vttFile = files.find((file) => file.endsWith(".vtt"));

    if (!vttFile) return null;

    const vttContent = await readFile(join(workDir, vttFile), "utf-8");
    const segments = parseTranscriptSegments(vttContent);
    return segments.length ? segments : null;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function whisperFallback(
  url: string,
  videoId: string,
  logger?: ExtractLogger,
): Promise<TranscriptSegment[] | null> {
  const whisperCommand = "whisper-cli";
  if (!(await hasCommand(whisperCommand))) {
    logError("whisper.cpp not found — cannot transcribe audio. Run `outform install whisper`.", logger);
    return null;
  }

  if (!(await hasCommand("ffmpeg")) || !(await hasCommand("ffprobe"))) {
    logError("ffmpeg and ffprobe are required for audio transcription. Run `outform install ffmpeg`.", logger);
    return null;
  }

  const model = await findWhisperModel();
  if (!model) {
    logError(
      "No whisper model found. Run `outform install whisper` to download the base.en model,\n" +
        "or set WHISPER_MODEL=/path/to/ggml-base.en.bin",
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

async function downloadAudio(url: string, workDir: string, logger?: ExtractLogger): Promise<string | null> {
  const s = spin("Downloading audio for transcription...", logger);
  const proc = spawn(
    ytDlpCommand(
      [
        "--extract-audio",
        "--audio-format",
        "wav",
        "--postprocessor-args",
        "ffmpeg:-ar 16000 -ac 1",
        "-o",
        join(workDir, "audio.%(ext)s"),
        url,
      ],
      true,
    ),
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
): Promise<TranscriptSegment[] | null> {
  const s = spin("Transcribing audio with whisper.cpp...", logger);
  const output = join(dirname(audioPath), "transcript");
  const proc = spawn([command, "-m", modelPath, "-f", audioPath, "--output-json", "--output-file", output], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const { stderr, exitCode } = await waitForResult(proc);

  if (exitCode !== 0) {
    s.stop("Transcription failed");
    logError(`whisper-cpp failed: ${stderr.trim() || "unknown error"}`, logger);
    return null;
  }
  s.stop("Audio transcribed");

  const segments = parseWhisperSegments(JSON.parse(await readFile(`${output}.json`, "utf8")));
  return segments.length ? segments : null;
}
