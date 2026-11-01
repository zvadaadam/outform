import { writeWithDirs } from "../utils/process";
import { extractDomain, hashString } from "../utils/url";
import type { WebResult } from "../extractors/web";
import type { PdfResult } from "../extractors/pdf";
import type { YouTubeResult, YouTubeMetadata } from "../extractors/youtube";
import type { MediaResult } from "../extractors/media";
import type { OutformIssue } from "../errors";
import { formatTimestamp } from "../utils/vtt";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUTPUT_DIR = join(tmpdir(), "outform");

export interface WebJsonOutput {
  type: "web";
  title: string;
  author: string | null;
  source: string;
  excerpt: string | null;
  content: string;
}

export interface PdfJsonOutput {
  type: "pdf";
  title: string;
  pageCount: number;
  source: string;
  content: string;
}

export interface YouTubeJsonOutput extends YouTubeMetadata {
  type: "youtube";
  chapters: YouTubeResult["chapters"];
  transcript: string;
  transcriptSegments: YouTubeResult["transcriptSegments"];
  transcriptSource: YouTubeResult["transcriptSource"];
  chaptersSource: YouTubeResult["chaptersSource"];
  issues: OutformIssue[];
}

export interface MediaJsonOutput extends MediaResult {
  type: "media";
}

export function buildMediaJson(result: MediaResult): MediaJsonOutput {
  return { type: "media", ...result };
}

export function formatMediaMarkdown(result: MediaResult): string {
  const lines = [`# ${result.title}`, "", `**Platform:** ${result.platform}`, `**Source:** ${result.source}`];
  if (result.author) lines.push(`**Author:** ${result.author}`);
  if (result.uploadDate) lines.push(`**Uploaded:** ${result.uploadDate}`);
  if (result.description) lines.push("", "## Description", "", result.description);
  lines.push("", "## Media", "");
  for (const asset of result.media) {
    const target = asset.file ?? asset.url;
    lines.push(
      `${asset.index}. **${asset.kind}**${asset.width && asset.height ? ` (${asset.width}×${asset.height})` : ""}${asset.duration !== null ? ` — ${formatTimestamp(asset.duration)}` : ""}`,
    );
    if (target) lines.push(`   ${target}`);
    else lines.push("   Use `outform download` to save this media.");
    if (asset.thumbnail && asset.kind !== "image") lines.push(`   Thumbnail: ${asset.thumbnail}`);
  }
  if (result.directory) lines.push("", `Saved to: ${result.directory}`);
  for (const issue of result.issues) lines.push("", `Note: ${issue.message}`);
  return lines.join("\n") + "\n";
}

export function formatMediaText(result: MediaResult): string {
  const lines = [result.title, `Platform: ${result.platform}`, `Source: ${result.source}`];
  if (result.author) lines.push(`Author: ${result.author}`);
  if (result.uploadDate) lines.push(`Uploaded: ${result.uploadDate}`);
  if (result.description) lines.push("", result.description);
  for (const asset of result.media)
    lines.push(
      "",
      `${asset.index}. ${asset.kind}: ${asset.file ?? asset.url ?? "Use outform download to save this media."}`,
    );
  if (result.directory) lines.push("", `Saved to: ${result.directory}`);
  for (const issue of result.issues) lines.push(`Note: ${issue.message}`);
  return lines.join("\n") + "\n";
}

export function buildWebJson(result: WebResult): WebJsonOutput {
  return {
    type: "web",
    title: result.title,
    author: result.author,
    source: result.source,
    excerpt: result.excerpt,
    content: result.content,
  };
}

export function formatWebMarkdown(result: WebResult): string {
  const lines: string[] = [];

  lines.push(`# ${result.title}`);
  lines.push("");

  if (result.author) {
    lines.push(`**Author:** ${result.author}`);
  }
  lines.push(`**Source:** ${result.source}`);
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## Content");
  lines.push("");
  lines.push(result.content);
  lines.push("");

  return lines.join("\n");
}

export function formatWebText(result: WebResult): string {
  const lines: string[] = [];

  lines.push(result.title);
  lines.push("=".repeat(result.title.length));
  lines.push("");
  if (result.author) lines.push(`Author: ${result.author}`);
  lines.push(`Source: ${result.source}`);
  lines.push("");

  lines.push(result.textContent);
  lines.push("");

  return lines.join("\n");
}

export function formatWebJson(result: WebResult): string {
  return JSON.stringify(buildWebJson(result), null, 2);
}

export function getWebOutputPath(url: string, format: string = "md"): string {
  const domain = extractDomain(url);
  const hash = hashString(url);
  const ext = format === "json" ? "json" : format === "txt" ? "txt" : "md";
  return `${OUTPUT_DIR}/web-${domain}-${hash}.${ext}`;
}

export function buildPdfJson(result: PdfResult): PdfJsonOutput {
  return {
    type: "pdf",
    title: result.title,
    pageCount: result.pageCount,
    source: result.source,
    content: result.content,
  };
}

export function formatPdfMarkdown(result: PdfResult): string {
  const lines: string[] = [];

  lines.push(`# ${result.title}`);
  lines.push("");
  lines.push(`**Source:** ${result.source}`);
  lines.push(`**Pages:** ${result.pageCount}`);
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## Content");
  lines.push("");
  lines.push(result.content);
  lines.push("");

  return lines.join("\n");
}

export function formatPdfText(result: PdfResult): string {
  const lines: string[] = [];

  lines.push(result.title);
  lines.push("=".repeat(result.title.length));
  lines.push("");
  lines.push(`Source: ${result.source}`);
  lines.push(`Pages: ${result.pageCount}`);
  lines.push("");

  lines.push(result.content);
  lines.push("");

  return lines.join("\n");
}

export function formatPdfJson(result: PdfResult): string {
  return JSON.stringify(buildPdfJson(result), null, 2);
}

export function getPdfOutputPath(url: string, format: string = "md"): string {
  const hash = hashString(url);
  const ext = format === "json" ? "json" : format === "txt" ? "txt" : "md";
  return `${OUTPUT_DIR}/pdf-${hash}.${ext}`;
}

export function buildYouTubeJson(result: YouTubeResult): YouTubeJsonOutput {
  return {
    type: "youtube",
    videoId: result.videoId,
    author: result.author,
    channelId: result.channelId,
    channelUrl: result.channelUrl,
    thumbnail: result.thumbnail,
    uploadDate: result.uploadDate,
    title: result.title,
    channel: result.channel,
    source: result.source,
    duration: result.duration,
    description: result.description,
    chapters: result.chapters,
    transcript: result.transcript,
    transcriptSegments: result.transcriptSegments,
    transcriptSource: result.transcriptSource,
    chaptersSource: result.chaptersSource,
    issues: result.issues,
  };
}

export function formatYouTubeMarkdown(result: YouTubeResult): string {
  const lines: string[] = [];

  lines.push(`# ${result.title}`);
  lines.push("");
  lines.push(`**Channel:** ${result.channel}`);
  if (result.channelUrl) lines.push(`**Channel URL:** ${result.channelUrl}`);
  if (result.uploadDate) lines.push(`**Uploaded:** ${result.uploadDate}`);
  if (result.thumbnail) lines.push(`**Thumbnail:** ${result.thumbnail}`);
  lines.push(`**Source:** ${result.source}`);
  if (result.duration !== null) {
    lines.push(`**Duration:** ${formatTimestamp(result.duration)}`);
  }
  lines.push("");

  if (result.description) {
    lines.push("## Description");
    lines.push("");
    lines.push(result.description);
    lines.push("");
  }

  if (result.chapters && result.chapters.length > 0) {
    lines.push(result.chaptersSource === "generated" ? "## Chapters (AI-generated)" : "## Chapters");
    lines.push("");
    for (const ch of result.chapters) {
      const timestamp = formatTimestamp(ch.startTime);
      const link = `${result.source}&t=${Math.floor(ch.startTime)}s`;
      lines.push(`- **[${timestamp}](${link})** — ${ch.title}${ch.description ? `: ${ch.description}` : ""}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## Transcript");
  lines.push("");
  if (result.transcriptSegments.length) {
    for (const segment of result.transcriptSegments) {
      lines.push(`[${formatTimestamp(segment.startTime)}] ${segment.text}`);
    }
  } else lines.push(result.transcript || "Transcript unavailable.");
  lines.push("");

  for (const issue of result.issues) lines.push(`Note: ${issue.message}`);
  return lines.join("\n");
}

export function formatYouTubeText(result: YouTubeResult): string {
  const lines: string[] = [];

  lines.push(result.title);
  lines.push("=".repeat(result.title.length));
  lines.push("");
  lines.push(`Channel: ${result.channel}`);
  if (result.channelUrl) lines.push(`Channel URL: ${result.channelUrl}`);
  if (result.uploadDate) lines.push(`Uploaded: ${result.uploadDate}`);
  if (result.thumbnail) lines.push(`Thumbnail: ${result.thumbnail}`);
  lines.push(`Source: ${result.source}`);
  if (result.duration !== null) {
    lines.push(`Duration: ${formatTimestamp(result.duration)}`);
  }
  lines.push("");

  if (result.description) {
    lines.push("Description:");
    lines.push(result.description);
    lines.push("");
  }

  if (result.chapters && result.chapters.length > 0) {
    lines.push(result.chaptersSource === "generated" ? "Chapters (AI-generated):" : "Chapters:");
    for (const ch of result.chapters) {
      lines.push(`  ${formatTimestamp(ch.startTime)} - ${ch.title}${ch.description ? `: ${ch.description}` : ""}`);
    }
    lines.push("");
  }

  lines.push("Transcript:");
  if (result.transcriptSegments.length) {
    for (const segment of result.transcriptSegments) {
      lines.push(`[${formatTimestamp(segment.startTime)}] ${segment.text}`);
    }
  } else lines.push(result.transcript || "Transcript unavailable.");
  lines.push("");

  for (const issue of result.issues) lines.push(`Note: ${issue.message}`);
  return lines.join("\n");
}

export function formatYouTubeJson(result: YouTubeResult): string {
  return JSON.stringify(buildYouTubeJson(result), null, 2);
}

export function getYouTubeOutputPath(videoId: string, format: string = "md"): string {
  const ext = format === "json" ? "json" : format === "txt" ? "txt" : "md";
  return `${OUTPUT_DIR}/yt-${videoId}.${ext}`;
}

export async function writeOutput(filePath: string, content: string): Promise<void> {
  await writeWithDirs(filePath, content);
}
