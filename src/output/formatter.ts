import { writeWithDirs } from "../utils/process"
import { extractDomain, hashString } from "../utils/url"
import type { WebResult } from "../extractors/web"
import type { PdfResult } from "../extractors/pdf"
import type { YouTubeResult } from "../extractors/youtube"
import { formatTimestamp } from "../utils/vtt"

const OUTPUT_DIR = "/tmp/extractor"

export interface WebJsonOutput {
  type: "web"
  title: string
  author: string | null
  source: string
  excerpt: string | null
  summary: string | null
  content: string
}

export interface PdfJsonOutput {
  type: "pdf"
  title: string
  pageCount: number
  source: string
  summary: string | null
  content: string
}

export interface YouTubeJsonOutput {
  type: "youtube"
  title: string
  channel: string
  source: string
  duration: number | null
  description: string
  summary: string | null
  chapters: YouTubeResult["chapters"]
  transcript: string
}

export function buildWebJson(
  result: WebResult,
  aiSummary?: string | null
): WebJsonOutput {
  return {
    type: "web",
    title: result.title,
    author: result.author,
    source: result.source,
    excerpt: result.excerpt,
    summary: aiSummary || null,
    content: result.content,
  }
}

export function formatWebMarkdown(
  result: WebResult,
  aiSummary?: string | null
): string {
  const lines: string[] = []

  lines.push(`# ${result.title}`)
  lines.push("")

  if (result.author) {
    lines.push(`**Author:** ${result.author}`)
  }
  lines.push(`**Source:** ${result.source}`)
  lines.push("")

  if (aiSummary) {
    lines.push("## Summary")
    lines.push("")
    lines.push(aiSummary)
    lines.push("")
  }

  lines.push("---")
  lines.push("")
  lines.push("## Content")
  lines.push("")
  lines.push(result.content)
  lines.push("")

  return lines.join("\n")
}

export function formatWebText(
  result: WebResult,
  aiSummary?: string | null
): string {
  const lines: string[] = []

  lines.push(result.title)
  lines.push("=".repeat(result.title.length))
  lines.push("")
  if (result.author) lines.push(`Author: ${result.author}`)
  lines.push(`Source: ${result.source}`)
  lines.push("")

  if (aiSummary) {
    lines.push("Summary:")
    lines.push(aiSummary)
    lines.push("")
  }

  lines.push(result.textContent)
  lines.push("")

  return lines.join("\n")
}

export function formatWebJson(
  result: WebResult,
  aiSummary?: string | null
): string {
  return JSON.stringify(buildWebJson(result, aiSummary), null, 2)
}

export function getWebOutputPath(url: string, format: string = "md"): string {
  const domain = extractDomain(url)
  const hash = hashString(url)
  const ext = format === "json" ? "json" : format === "txt" ? "txt" : "md"
  return `${OUTPUT_DIR}/web-${domain}-${hash}.${ext}`
}

export function buildPdfJson(
  result: PdfResult,
  aiSummary?: string | null
): PdfJsonOutput {
  return {
    type: "pdf",
    title: result.title,
    pageCount: result.pageCount,
    source: result.source,
    summary: aiSummary || null,
    content: result.content,
  }
}

export function formatPdfMarkdown(
  result: PdfResult,
  aiSummary?: string | null
): string {
  const lines: string[] = []

  lines.push(`# ${result.title}`)
  lines.push("")
  lines.push(`**Source:** ${result.source}`)
  lines.push(`**Pages:** ${result.pageCount}`)
  lines.push("")

  if (aiSummary) {
    lines.push("## Summary")
    lines.push("")
    lines.push(aiSummary)
    lines.push("")
  }

  lines.push("---")
  lines.push("")
  lines.push("## Content")
  lines.push("")
  lines.push(result.content)
  lines.push("")

  return lines.join("\n")
}

export function formatPdfText(
  result: PdfResult,
  aiSummary?: string | null
): string {
  const lines: string[] = []

  lines.push(result.title)
  lines.push("=".repeat(result.title.length))
  lines.push("")
  lines.push(`Source: ${result.source}`)
  lines.push(`Pages: ${result.pageCount}`)
  lines.push("")

  if (aiSummary) {
    lines.push("Summary:")
    lines.push(aiSummary)
    lines.push("")
  }

  lines.push(result.content)
  lines.push("")

  return lines.join("\n")
}

export function formatPdfJson(
  result: PdfResult,
  aiSummary?: string | null
): string {
  return JSON.stringify(buildPdfJson(result, aiSummary), null, 2)
}

export function getPdfOutputPath(url: string, format: string = "md"): string {
  const hash = hashString(url)
  const ext = format === "json" ? "json" : format === "txt" ? "txt" : "md"
  return `${OUTPUT_DIR}/pdf-${hash}.${ext}`
}

export function buildYouTubeJson(
  result: YouTubeResult,
  aiSummary?: string | null
): YouTubeJsonOutput {
  return {
    type: "youtube",
    title: result.title,
    channel: result.channel,
    source: result.source,
    duration: result.duration,
    description: result.description,
    summary: aiSummary || null,
    chapters: result.chapters,
    transcript: result.transcript,
  }
}

export function formatYouTubeMarkdown(
  result: YouTubeResult,
  aiSummary?: string | null
): string {
  const lines: string[] = []

  lines.push(`# ${result.title}`)
  lines.push("")
  lines.push(`**Channel:** ${result.channel}`)
  lines.push(`**Source:** ${result.source}`)
  if (result.duration) {
    lines.push(`**Duration:** ${formatTimestamp(result.duration)}`)
  }
  lines.push("")

  if (aiSummary) {
    lines.push("## Summary")
    lines.push("")
    lines.push(aiSummary)
    lines.push("")
  }

  if (result.description) {
    lines.push("## Description")
    lines.push("")
    lines.push(result.description)
    lines.push("")
  }

  if (result.chapters && result.chapters.length > 0) {
    lines.push("## Chapters")
    lines.push("")
    for (const ch of result.chapters) {
      lines.push(`- **${formatTimestamp(ch.startTime)}** — ${ch.title}`)
    }
    lines.push("")
  }

  lines.push("---")
  lines.push("")
  lines.push("## Transcript")
  lines.push("")
  lines.push(result.transcript)
  lines.push("")

  return lines.join("\n")
}

export function formatYouTubeText(
  result: YouTubeResult,
  aiSummary?: string | null
): string {
  const lines: string[] = []

  lines.push(result.title)
  lines.push("=".repeat(result.title.length))
  lines.push("")
  lines.push(`Channel: ${result.channel}`)
  lines.push(`Source: ${result.source}`)
  if (result.duration) {
    lines.push(`Duration: ${formatTimestamp(result.duration)}`)
  }
  lines.push("")

  if (aiSummary) {
    lines.push("Summary:")
    lines.push(aiSummary)
    lines.push("")
  }

  if (result.description) {
    lines.push("Description:")
    lines.push(result.description)
    lines.push("")
  }

  if (result.chapters && result.chapters.length > 0) {
    lines.push("Chapters:")
    for (const ch of result.chapters) {
      lines.push(`  ${formatTimestamp(ch.startTime)} - ${ch.title}`)
    }
    lines.push("")
  }

  lines.push("Transcript:")
  lines.push(result.transcript)
  lines.push("")

  return lines.join("\n")
}

export function formatYouTubeJson(
  result: YouTubeResult,
  aiSummary?: string | null
): string {
  return JSON.stringify(buildYouTubeJson(result, aiSummary), null, 2)
}

export function getYouTubeOutputPath(videoId: string, format: string = "md"): string {
  const ext = format === "json" ? "json" : format === "txt" ? "txt" : "md"
  return `${OUTPUT_DIR}/yt-${videoId}.${ext}`
}

export async function writeOutput(
  filePath: string,
  content: string
): Promise<void> {
  await writeWithDirs(filePath, content)
}
