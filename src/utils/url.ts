export type UrlType = "youtube" | "web" | "pdf";

const YOUTUBE_PATTERNS = [
  /^https?:\/\/(www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
  /^https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{11})/,
  /^https?:\/\/(www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  /^https?:\/\/(www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
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
      return match[2] ?? match[1];
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
  const hash = Bun.hash(input);
  return hash.toString(16).slice(0, 8);
}

export function isValidUrl(input: string): boolean {
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
}
