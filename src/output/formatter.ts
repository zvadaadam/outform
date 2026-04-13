import { mkdir } from "fs/promises";
import { extractDomain, hashString } from "../utils/url";
import type { WebResult } from "../extractors/web";
import type { PdfResult } from "../extractors/pdf";
import type { YouTubeResult } from "../extractors/youtube";
import { formatTimestamp } from "../utils/vtt";

const OUTPUT_DIR = "/tmp/extractor";

export function formatWebMarkdown(
  result: WebResult,
  aiSummary?: string | null
): string {
  const lines: string[] = [];

  lines.push(`# ${result.title}`);
  lines.push("");

  if (result.author) {
    lines.push(`**Author:** ${result.author}`);
  }
  lines.push(`**Source:** ${result.source}`);
  lines.push("");

  if (aiSummary) {
    lines.push("## Summary");
    lines.push("");
    lines.push(aiSummary);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## Content");
  lines.push("");
  lines.push(result.content);
  lines.push("");

  return lines.join("\n");
}

export function formatWebText(
  result: WebResult,
  aiSummary?: string | null
): string {
  const lines: string[] = [];

  lines.push(result.title);
  lines.push("=".repeat(result.title.length));
  lines.push("");
  if (result.author) lines.push(`Author: ${result.author}`);
  lines.push(`Source: ${result.source}`);
  lines.push("");

  if (aiSummary) {
    lines.push("Summary:");
    lines.push(aiSummary);
    lines.push("");
  }

  lines.push(result.textContent);
  lines.push("");

  return lines.join("\n");
}

export function formatWebJson(
  result: WebResult,
  aiSummary?: string | null
): string {
  return JSON.stringify(
    {
      type: "web",
      title: result.title,
      author: result.author,
      source: result.source,
      excerpt: result.excerpt,
      summary: aiSummary || null,
      content: result.content,
    },
    null,
    2
  );
}

export function getWebOutputPath(url: string): string {
  const domain = extractDomain(url);
  const hash = hashString(url);
  return `${OUTPUT_DIR}/web-${domain}-${hash}.md`;
}

export function formatPdfMarkdown(
  result: PdfResult,
  aiSummary?: string | null
): string {
  const lines: string[] = [];

  lines.push(`# ${result.title}`);
  lines.push("");
  lines.push(`**Source:** ${result.source}`);
  lines.push(`**Pages:** ${result.pageCount}`);
  lines.push("");

  if (aiSummary) {
    lines.push("## Summary");
    lines.push("");
    lines.push(aiSummary);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## Content");
  lines.push("");
  lines.push(result.content);
  lines.push("");

  return lines.join("\n");
}

export function formatPdfText(
  result: PdfResult,
  aiSummary?: string | null
): string {
  const lines: string[] = [];

  lines.push(result.title);
  lines.push("=".repeat(result.title.length));
  lines.push("");
  lines.push(`Source: ${result.source}`);
  lines.push(`Pages: ${result.pageCount}`);
  lines.push("");

  if (aiSummary) {
    lines.push("Summary:");
    lines.push(aiSummary);
    lines.push("");
  }

  lines.push(result.content);
  lines.push("");

  return lines.join("\n");
}

export function formatPdfJson(
  result: PdfResult,
  aiSummary?: string | null
): string {
  return JSON.stringify(
    {
      type: "pdf",
      title: result.title,
      pageCount: result.pageCount,
      source: result.source,
      summary: aiSummary || null,
      content: result.content,
    },
    null,
    2
  );
}

export function getPdfOutputPath(url: string): string {
  const hash = hashString(url);
  return `${OUTPUT_DIR}/pdf-${hash}.md`;
}

export function formatYouTubeMarkdown(
  result: YouTubeResult,
  aiSummary?: string | null
): string {
  const lines: string[] = [];

  lines.push(`# ${result.title}`);
  lines.push("");
  lines.push(`**Channel:** ${result.channel}`);
  lines.push(`**Source:** ${result.source}`);
  if (result.duration) {
    lines.push(`**Duration:** ${formatTimestamp(result.duration)}`);
  }
  lines.push("");

  if (aiSummary) {
    lines.push("## Summary");
    lines.push("");
    lines.push(aiSummary);
    lines.push("");
  }

  if (result.description) {
    lines.push("## Description");
    lines.push("");
    lines.push(result.description);
    lines.push("");
  }

  if (result.chapters && result.chapters.length > 0) {
    lines.push("## Chapters");
    lines.push("");
    for (const ch of result.chapters) {
      lines.push(`- **${formatTimestamp(ch.startTime)}** — ${ch.title}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## Transcript");
  lines.push("");
  lines.push(result.transcript);
  lines.push("");

  return lines.join("\n");
}

export function formatYouTubeText(
  result: YouTubeResult,
  aiSummary?: string | null
): string {
  const lines: string[] = [];

  lines.push(result.title);
  lines.push("=".repeat(result.title.length));
  lines.push("");
  lines.push(`Channel: ${result.channel}`);
  lines.push(`Source: ${result.source}`);
  if (result.duration) {
    lines.push(`Duration: ${formatTimestamp(result.duration)}`);
  }
  lines.push("");

  if (aiSummary) {
    lines.push("Summary:");
    lines.push(aiSummary);
    lines.push("");
  }

  if (result.description) {
    lines.push("Description:");
    lines.push(result.description);
    lines.push("");
  }

  if (result.chapters && result.chapters.length > 0) {
    lines.push("Chapters:");
    for (const ch of result.chapters) {
      lines.push(`  ${formatTimestamp(ch.startTime)} - ${ch.title}`);
    }
    lines.push("");
  }

  lines.push("Transcript:");
  lines.push(result.transcript);
  lines.push("");

  return lines.join("\n");
}

export function formatYouTubeJson(
  result: YouTubeResult,
  aiSummary?: string | null
): string {
  return JSON.stringify(
    {
      type: "youtube",
      title: result.title,
      channel: result.channel,
      source: result.source,
      duration: result.duration,
      description: result.description,
      summary: aiSummary || null,
      chapters: result.chapters,
      transcript: result.transcript,
    },
    null,
    2
  );
}

export function getYouTubeOutputPath(videoId: string): string {
  return `${OUTPUT_DIR}/yt-${videoId}.md`;
}

export async function writeOutput(
  filePath: string,
  content: string
): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await Bun.write(filePath, content);
}
