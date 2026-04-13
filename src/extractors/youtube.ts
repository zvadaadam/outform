import { logProgress, logError } from "../utils/log";
import { extractYouTubeId } from "../utils/url";
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

  logProgress("Fetching video metadata...");
  const metadata = await fetchMetadata(url);

  logProgress("Downloading captions...");
  const transcript = await fetchCaptions(url, videoId, lang);

  if (!transcript) {
    throw new Error(
      `No captions available for this video in language "${lang}". ` +
        `Try a different language with --lang, or the video may not have subtitles.`
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
