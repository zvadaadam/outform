import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";

export type UrlType = "youtube" | "web" | "pdf" | "media";
export type MediaPlatform =
  | "instagram"
  | "x"
  | "tiktok"
  | "pinterest"
  | "facebook"
  | "reddit"
  | "vimeo"
  | "youtube"
  | "spotify";

export function mediaPlatform(input: string): MediaPlatform | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  const host = url.hostname.replace(/^(?:www|m|mobile)\./, "");
  const path = url.pathname;
  if (host === "instagram.com" && /^\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/[\w-]+/.test(path)) return "instagram";
  if (["x.com", "twitter.com"].includes(host) && /^\/(?:[\w]+\/status|i\/web\/status|i\/status)\/\d+/.test(path))
    return "x";
  if (
    (host === "tiktok.com" && /^\/@[^/]+\/(?:video|photo)\/\d+/.test(path)) ||
    ["vm.tiktok.com", "vt.tiktok.com"].includes(host)
  )
    return "tiktok";
  if (
    (/^(?:[a-z]{2}\.)?pinterest\.(?:com|co\.uk|ca|fr|de|com\.au|jp|es|it|co|com\.mx|pt|nl|ch|at|ie|in)$/.test(host) &&
      /^\/pin\/(?:[\w-]+--)?\d+/.test(path)) ||
    host === "pin.it"
  )
    return "pinterest";
  if (
    ["facebook.com", "fb.watch"].includes(host) &&
    (host === "fb.watch" ||
      /\/(?:videos|reel|watch)(?:\/|$)/.test(path) ||
      (path === "/video.php" && url.searchParams.has("v")))
  )
    return "facebook";
  if (["reddit.com", "old.reddit.com"].includes(host) && /\/comments\/[\w]+/.test(path)) return "reddit";
  if (host === "player.vimeo.com" && /^\/video\/\d+(?:\/|$)/.test(path)) return "vimeo";
  if (host === "vimeo.com" && /^\/\d+(?:\/|$)/.test(path)) return "vimeo";
  if (host === "open.spotify.com" && /^\/(?:embed\/|intl-[a-z]{2}\/)?(?:episode|track)\/[A-Za-z0-9]{22}\/?$/.test(path))
    return "spotify";
  if (extractYouTubeId(input)) return "youtube";
  return null;
}

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
  const platform = mediaPlatform(url);
  // A Reddit comments URL can be a text discussion; media download is explicit.
  if (platform && platform !== "reddit") return "media";
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
