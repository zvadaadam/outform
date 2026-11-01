import type { MediaPlatform } from "../../utils/url";
import type { OutformIssue } from "../../errors";

export type Info = Record<string, unknown>;
export interface MediaAsset {
  id: string;
  index: number;
  kind: "video" | "image" | "audio";
  url: string | null;
  thumbnail: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  file: string | null;
}
export interface MediaResult {
  platform: MediaPlatform;
  id: string;
  title: string;
  description: string;
  author: string | null;
  thumbnail: string | null;
  source: string;
  uploadDate: string | null;
  media: MediaAsset[];
  directory: string | null;
  issues: OutformIssue[];
}

export function record(value: unknown): value is Info {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function records(value: unknown): Info[] {
  return Array.isArray(value) ? value.filter(record) : [];
}
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
export function httpUrl(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export interface MediaCandidate {
  url: string;
  width?: number | null;
  height?: number | null;
}
export type MediaTransfer = { type: "http"; candidates: MediaCandidate[] } | { type: "yt-dlp"; info: Info };
export interface ResolvedMedia {
  result: MediaResult;
  transfers: Map<number, MediaTransfer>;
}
