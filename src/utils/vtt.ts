const VTT_HEADER = /^WEBVTT\s*$/m;
const VTT_TIMESTAMP = /^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}.*$/gm;
const SRT_TIMESTAMP = /^\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}.*$/gm;
const SRT_INDEX = /^\d+\s*$/gm;
const VTT_CUE_TAGS = /<[^>]+>/g;
const VTT_NOTE = /^NOTE\s[\s\S]*?(?=\n\n|\n$|$)/gm;
const VTT_STYLE = /^STYLE\s[\s\S]*?(?=\n\n|\n$|$)/gm;

export function stripVttTimestamps(input: string): string {
  let text = input;

  text = text.replace(VTT_HEADER, "");
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
}

export function parseChapters(metadata: Record<string, any>): Chapter[] | null {
  const chapters = metadata.chapters;
  if (!Array.isArray(chapters) || chapters.length === 0) return null;

  return chapters.map((ch: any) => ({
    title: ch.title || "Untitled",
    startTime: ch.start_time ?? 0,
    endTime: ch.end_time,
  }));
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
