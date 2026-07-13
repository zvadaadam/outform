import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";

export type UrlType = "youtube" | "web" | "pdf";

const YOUTUBE_PATTERNS = [
  /^https?:\/\/(?:[a-z]+\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
  /^https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{11})/,
  /^https?:\/\/(?:[a-z]+\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  /^https?:\/\/(?:[a-z]+\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  /^https?:\/\/(?:[a-z]+\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
];

export function detectUrlType(url: string): UrlType {
  for (const pattern of YOUTUBE_PATTERNS) {
    if (pattern.test(url)) return "youtube";
  }
  if (/\.pdf(\?.*)?$/i.test(url)) return "pdf";
  return "web";
}

export function extractYouTubeId(url: string): string | null {
  for (const pattern of YOUTUBE_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      return match[1] ?? null;
    }
  }
  return null;
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}

export function isValidUrl(input: string): boolean {
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
}

export async function isValidSource(input: string): Promise<boolean> {
  if (isValidUrl(input)) return true;

  try {
    return (await stat(input)).isFile();
  } catch {
    return false;
  }
}
