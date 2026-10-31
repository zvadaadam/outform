const VTT_HEADER_BLOCK = /^\uFEFF?WEBVTT[^\n]*(?:\n(?!\s*\n)[^\n]*)*/;
const VTT_TIMESTAMP = /^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}.*$/gm;
const SRT_TIMESTAMP = /^\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}.*$/gm;
const SRT_INDEX = /^\d+\s*$/gm;
const VTT_CUE_TAGS = /<[^>]+>/g;
const VTT_NOTE = /^NOTE\s[\s\S]*?(?=\n\n|\n$|$)/gm;
const VTT_STYLE = /^STYLE\s[\s\S]*?(?=\n\n|\n$|$)/gm;

export function stripVttTimestamps(input: string): string {
  let text = input;

  text = text.replace(VTT_HEADER_BLOCK, "");
  text = text.replace(VTT_NOTE, "");
  text = text.replace(VTT_STYLE, "");
  text = text.replace(VTT_TIMESTAMP, "");
  text = text.replace(SRT_TIMESTAMP, "");
  text = text.replace(SRT_INDEX, "");
  text = text.replace(VTT_CUE_TAGS, "");

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return deduplicateLines(lines);
}

function deduplicateLines(lines: string[]): string {
  const unique: string[] = [];

  for (const line of lines) {
    if (unique.length === 0 || unique[unique.length - 1] !== line) {
      unique.push(line);
    }
  }

  return mergeParagraphs(unique);
}

function mergeParagraphs(lines: string[]): string {
  if (lines.length === 0) return "";

  const paragraphs: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.endsWith(".") || line.endsWith("?") || line.endsWith("!")) {
      current.push(line);
      paragraphs.push(current.join(" "));
      current = [];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    paragraphs.push(current.join(" "));
  }

  return paragraphs.join("\n\n");
}

export interface Chapter {
  title: string;
  startTime: number;
  endTime?: number;
  description?: string;
}

export function parseChapters(metadata: Record<string, unknown>): Chapter[] | null {
  if (!Array.isArray(metadata.chapters)) return null;
  const chapters: Chapter[] = [];
  const duration =
    typeof metadata.duration === "number" && Number.isFinite(metadata.duration) && metadata.duration > 0
      ? metadata.duration
      : undefined;
  for (const value of metadata.chapters) {
    if (!value || typeof value !== "object") continue;
    const chapter = value as Record<string, unknown>;
    const start = chapter.start_time;
    if (
      typeof start !== "number" ||
      !Number.isFinite(start) ||
      start < 0 ||
      (duration !== undefined && start >= duration)
    )
      continue;
    if (chapters.length && start <= chapters[chapters.length - 1]!.startTime) continue;
    const end = chapter.end_time;
    chapters.push({
      title:
        typeof chapter.title === "string" && chapter.title.trim()
          ? chapter.title.trim().replace(/\s+/g, " ")
          : "Untitled",
      startTime: start,
      ...(typeof end === "number" && Number.isFinite(end) && end > start ? { endTime: end } : {}),
    });
  }
  for (let index = 0; index < chapters.length; index++) {
    const chapter = chapters[index]!;
    const boundary = chapters[index + 1]?.startTime ?? duration;
    if (boundary !== undefined) chapter.endTime = Math.min(chapter.endTime ?? boundary, boundary);
  }
  return chapters.length ? chapters : null;
}

export interface TranscriptSegment {
  startTime: number;
  endTime: number;
  text: string;
}

function captionSeconds(timestamp: string): number {
  const parts = timestamp.replace(",", ".").split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function captionText(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
      if (!code.startsWith("#")) return named[code.toLowerCase()] ?? entity;
      const value = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTranscriptSegments(input: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let previousCue: (TranscriptSegment & { inlineTiming: boolean }) | undefined;
  for (const block of input.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    if (/^(?:\uFEFF?WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(block)) continue;
    const lines = block.split("\n");
    const index = lines.findIndex((line) => /-->/.test(line));
    if (index < 0) continue;
    const match = lines[index]!.match(
      /^((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})(?:\s|$)/,
    );
    if (!match) continue;
    const startTime = captionSeconds(match[1]!);
    const endTime = captionSeconds(match[2]!);
    let text = captionText(lines.slice(index + 1).join(" "));
    if (!text || endTime <= startTime) continue;
    const previous = previousCue;
    if (previous && startTime < previous.startTime) continue;
    const inlineTiming = /<(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}>/.test(block);
    previousCue = { startTime, endTime, text, inlineTiming };
    // YouTube rolling captions repeat the preceding cue before adding new words.
    if (
      previous &&
      (startTime < previous.endTime ||
        ((inlineTiming || previous.inlineTiming) && startTime <= previous.endTime + 0.02))
    ) {
      if (previous.text === text) {
        const last = segments.at(-1);
        if (last) last.endTime = Math.max(last.endTime, endTime);
        continue;
      }
      const words = text.split(" ");
      const prior = previous.text.split(" ");
      for (let count = Math.min(words.length, prior.length); count > 0; count--) {
        if (prior.slice(-count).join(" ") === words.slice(0, count).join(" ")) {
          text = words.slice(count).join(" ");
          break;
        }
      }
    }
    if (text) segments.push({ startTime, endTime, text });
  }
  return segments;
}

export function parseWhisperSegments(input: unknown): TranscriptSegment[] {
  if (!input || typeof input !== "object" || !("transcription" in input) || !Array.isArray(input.transcription))
    return [];
  const segments: TranscriptSegment[] = [];
  for (const row of input.transcription) {
    if (!row || typeof row !== "object" || typeof row.text !== "string") continue;
    const start = row.offsets?.from;
    const end = row.offsets?.to;
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start
    )
      continue;
    const text = row.text.trim();
    if (text && (!segments.length || start / 1000 >= segments.at(-1)!.startTime))
      segments.push({ startTime: start / 1000, endTime: end / 1000, text });
  }
  return segments;
}

export function transcriptText(segments: TranscriptSegment[]): string {
  return mergeParagraphs(segments.map((segment) => segment.text));
}

export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}
