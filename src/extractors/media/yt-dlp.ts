import { writeFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn, toolPath, waitForResult } from "../../utils/process";
import type { MediaPlatform } from "../../utils/url";
import { mediaError, mediaSourceFailure, type OutformIssue } from "../../errors";
import {
  record,
  records,
  text,
  number,
  httpUrl,
  type Info,
  type MediaResult,
  type MediaAsset,
  type ResolvedMedia,
  type MediaTransfer,
  type MediaSaveOptions,
} from "./metadata";

function thumbnail(info: Info): Info | undefined {
  const thumbnails = records(info.thumbnails);
  const preferred = thumbnails.find((item) => httpUrl(item.url) && item.url === info.thumbnail);
  if (preferred) return preferred;
  return thumbnails
    .reverse()
    .filter((t) => httpUrl(t.url))
    .sort(
      (a, b) => (number(b.width) ?? 0) * (number(b.height) ?? 0) - (number(a.width) ?? 0) * (number(a.height) ?? 0),
    )[0];
}
async function runDownloader(
  args: string[],
  url: string,
  timeoutMs = 90_000,
  options: MediaSaveOptions = {},
  directory?: string,
): Promise<string> {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]);
  signal.throwIfAborted();
  const proc = spawn(
    [
      "yt-dlp",
      "--ignore-config",
      "--no-warnings",
      "--socket-timeout",
      "20",
      "--retries",
      "1",
      "--extractor-retries",
      "1",
      ...args,
    ],
    { signal },
  );
  const timer = setTimeout(() => {
    controller.abort(
      mediaError(`Media request timed out after ${timeoutMs / 1000} seconds. Retry later.`, url, "DOWNLOAD_TIMEOUT"),
    );
  }, timeoutMs);
  let checking = false;
  const watcher =
    directory && options.maxBytes !== undefined
      ? setInterval(async () => {
          if (checking) return;
          checking = true;
          try {
            for (const name of await readdir(directory)) {
              if (name === "info.json") continue;
              const size = await stat(join(directory, name))
                .then((info) => info.size)
                .catch((error) => {
                  if (error.code === "ENOENT") return 0;
                  throw error;
                });
              if (size > options.maxBytes!)
                controller.abort(
                  mediaError(`Media exceeds the ${options.maxBytes}-byte limit.`, url, "LIMIT_EXCEEDED"),
                );
            }
          } catch (error) {
            controller.abort(error);
          } finally {
            checking = false;
          }
        }, 100)
      : undefined;
  try {
    const result = await waitForResult(proc);
    signal.throwIfAborted();
    if (result.exitCode !== 0) throw mediaSourceFailure(result.stderr, url);
    return result.stdout;
  } finally {
    clearTimeout(timer);
    if (watcher) clearInterval(watcher);
  }
}

export function parseMediaInfo(info: Info, source: string, platform: MediaPlatform): MediaResult {
  const entries = Array.isArray(info.entries) ? info.entries : [info];
  const issues: OutformIssue[] = [];
  const media: MediaAsset[] = [];
  for (const [offset, raw] of entries.entries()) {
    if (!record(raw)) {
      issues.push(mediaError(`Media item ${offset + 1} is unavailable. Other items are still included.`, source).issue);
      continue;
    }
    const formats = records(raw.formats).filter((f) => httpUrl(f.url));
    const image =
      raw.outform_image === true ||
      (["instagram", "pinterest"].includes(platform) &&
        !formats.length &&
        number(raw.duration) === null &&
        raw._has_drm !== true &&
        !/\/(?:reel|reels|tv)\//.test(source));
    const thumb = thumbnail(raw);
    if (!formats.length && !(image && thumb)) {
      issues.push(mediaError(`No downloadable media was returned for item ${offset + 1}.`, source).issue);
      continue;
    }
    const kind = image ? "image" : formats.every((f) => f.vcodec === "none") ? "audio" : "video";
    const hasAudio = formats.some((format) => format.acodec !== "none");
    const direct = [...formats]
      .reverse()
      .find(
        (f) =>
          (kind === "audio" || f.vcodec !== "none") &&
          (f.acodec !== "none" || !hasAudio) &&
          /^https?$/.test(text(f.protocol) || "https"),
      );
    media.push({
      id: text(raw.id) || String(offset + 1),
      index: offset + 1,
      kind,
      url: image ? httpUrl(thumb?.url) : httpUrl(direct?.url),
      thumbnail: httpUrl(thumb?.url) ?? httpUrl(raw.thumbnail),
      width: number(image ? thumb?.width : raw.width),
      height: number(image ? thumb?.height : raw.height),
      duration: number(raw.duration),
      file: null,
    });
  }
  const date = text(info.upload_date);
  const title = text(info.title) || `${platform} post`;
  return {
    platform,
    id: text(info.id),
    source,
    title:
      media.length && media.every((asset) => asset.kind === "image") ? title.replace(/^Video by /, "Post by ") : title,
    description: text(info.description),
    author: text(info.channel) || text(info.uploader) || null,
    thumbnail: httpUrl(thumbnail(info)?.url) ?? httpUrl(info.thumbnail),
    uploadDate: /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : null,
    media,
    directory: null,
    issues,
  };
}

export async function loadYtDlpInfo(
  url: string,
  platform: MediaPlatform,
  request = url,
  signal?: AbortSignal,
): Promise<Info> {
  if (platform === "vimeo" && new URL(url).hostname !== "player.vimeo.com") {
    const [, id, hash] = new URL(url).pathname.split("/");
    const player = new URL(`https://player.vimeo.com/video/${id}`);
    if (hash) player.searchParams.set("h", hash);
    request = player.href;
  }
  const extras =
    platform === "youtube" ? ["--no-playlist", "--no-js-runtimes", "--js-runtimes", `deno:${toolPath("deno")}`] : [];
  const output = await runDownloader(
    [
      "--skip-download",
      "--dump-single-json",
      "--ignore-no-formats-error",
      "--playlist-end",
      "51",
      ...extras,
      "--",
      request,
    ],
    url,
    90_000,
    { signal },
  );
  let info: unknown;
  try {
    info = JSON.parse(output);
  } catch {
    throw mediaError("The media downloader returned invalid metadata.", url);
  }
  if (!record(info)) throw mediaError("The site returned no public media metadata.", url);
  return info;
}

export function resolveYtDlpInfo(info: Info, url: string, platform: MediaPlatform): ResolvedMedia {
  const raw = Array.isArray(info.entries) ? info.entries : [info];
  if (raw.length > 50 || (number(info.playlist_count) ?? 0) > 50)
    throw mediaError("Use a single post with at most 50 media items, rather than a collection or profile.", url);
  const result = parseMediaInfo(info, url, platform);
  if (!result.media.length) throw mediaError("This post has no publicly downloadable images, video, or audio.", url);
  const transfers = new Map<number, MediaTransfer>();
  for (const asset of result.media) {
    const entry = raw[asset.index - 1] as Info;
    if (asset.kind !== "image") {
      transfers.set(asset.index, { type: "yt-dlp", info: entry });
      continue;
    }
    const variants = records(entry.thumbnails)
      .reverse()
      .sort(
        (a, b) => (number(b.width) ?? 0) * (number(b.height) ?? 0) - (number(a.width) ?? 0) * (number(a.height) ?? 0),
      );
    const urls = [
      ...new Set([asset.url, ...variants.map((item) => httpUrl(item.url))].filter((url): url is string => !!url)),
    ];
    transfers.set(asset.index, {
      type: "http",
      candidates: urls.map((url) => {
        const selected = variants.find((item) => item.url === url);
        return { url, width: number(selected?.width), height: number(selected?.height) };
      }),
    });
  }
  return { result, transfers };
}

export async function downloadYtDlpMedia(
  entry: Info,
  stage: string,
  url: string,
  options: MediaSaveOptions = {},
): Promise<string> {
  const info = { ...entry };
  for (const key of ["entries", "_filename", "filename", "filepath", "requested_downloads", "__files_to_move"])
    delete info[key];
  if (options.output === "audio") {
    for (const key of ["requested_formats", "requested_downloads"]) delete info[key];
  }
  await writeFile(join(stage, "info.json"), JSON.stringify(info));
  const downloaded = await runDownloader(
    [
      ...(options.output === "audio" ? ["-f", "bestaudio/best"] : []),
      ...(options.maxBytes === undefined ? [] : ["--max-filesize", String(options.maxBytes)]),
      "--load-info-json",
      join(stage, "info.json"),
      "--no-playlist",
      "--no-simulate",
      "--abort-on-unavailable-fragments",
      "--fragment-retries",
      "1",
      "--ffmpeg-location",
      dirname(toolPath("ffmpeg")),
      "--merge-output-format",
      "mp4/mkv",
      "-o",
      join(stage, "media.%(ext)s"),
    ],
    url,
    options.timeoutMs ?? 15 * 60_000,
    options,
    stage,
  );
  const names = (await readdir(stage)).filter((name) =>
    /^media\.(?:mp4|mkv|webm|mov|m4a|mp3|aac|ogg|opus|flac|wav|flv)$/.test(name),
  );
  if (names.length !== 1) {
    if (options.maxBytes !== undefined && /File is larger than max-filesize/i.test(downloaded))
      throw mediaError(`Media exceeds the ${options.maxBytes}-byte limit.`, url, "LIMIT_EXCEEDED");
    throw new Error("Downloader did not produce a complete media file.");
  }
  return join(stage, names[0]!);
}
