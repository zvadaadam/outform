import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { publicFetch } from "../utils/public-fetch";
import { hasCommand } from "../utils/deps";
import { spawn, toolPath, waitForResult } from "../utils/process";
import { mediaPlatform, type MediaPlatform } from "../utils/url";
import { logProgress, silentLogger, type ExtractLogger } from "../utils/log";
import { OutformError, missingDependencyIssue, type OutformIssue } from "../errors";

type Info = Record<string, unknown>;
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
  source: string;
  uploadDate: string | null;
  media: MediaAsset[];
  directory: string | null;
  issues: OutformIssue[];
}

function record(value: unknown): value is Info {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function records(value: unknown): Info[] {
  return Array.isArray(value) ? value.filter(record) : [];
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function httpUrl(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
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
function mediaError(message: string, url: string, code: OutformIssue["code"] = "MEDIA_UNAVAILABLE"): OutformError {
  return new OutformError({ code, capability: "media", urlType: "media", url, message });
}
function sourceFailure(stderr: string, url: string): OutformError {
  // Classify explicit site responses; a generic 403 does not prove a post is private.
  if (/fragment.*(?:not found|unable to continue)/i.test(stderr))
    return mediaError(
      "The video download stopped because a segment was unavailable. No incomplete video was saved. Retry the original post URL later.",
      url,
      "DOWNLOAD_FAILED",
    );
  if (/\b429\b|too many requests|rate[ -]?limit|try again in a few minutes/i.test(stderr))
    return mediaError(
      "The site is limiting requests from this connection. Wait a few minutes before retrying; repeated attempts may extend the limit.",
      url,
      "RATE_LIMITED",
    );
  if (/\bDRM\b|copyright protection|encrypted media/i.test(stderr))
    return mediaError(
      "This media is copy-protected (DRM). Outform cannot download protected streams. Try another public post.",
      url,
      "MEDIA_PROTECTED",
    );
  if (
    /private (?:video|post|account)|(?:video|post|account) is private|followers[ -]only|members[ -]only/i.test(stderr)
  )
    return mediaError(
      "The site reports that this post is private or limited to approved viewers. Outform only downloads anonymously accessible media. Try a public post.",
      url,
      "MEDIA_RESTRICTED",
    );
  if (
    /not available in your (?:country|region)|geo.?restrict|geo.?block|age[ -]restrict|confirm your age/i.test(stderr)
  )
    return mediaError(
      "The site restricts this media by age or location. It is not available anonymously from this connection. Try another public post.",
      url,
      "MEDIA_RESTRICTED",
    );
  if (/\b404\b|\b410\b|(?:video|post|media|content).{0,30}(?:removed|deleted|does not exist|not found)/i.test(stderr))
    return mediaError(
      "The site reports that this media is missing or removed. Check the original post URL in a browser for availability or a newer link.",
      url,
      "MEDIA_NOT_FOUND",
    );
  if (
    /login required|log(?:ged)?[ -]?in|sign[ -]?in|authentication is required|registered users|cookies.*authentication/i.test(
      stderr,
    )
  )
    return mediaError(
      "The site requires login for this request. The post may be restricted, or the site may be blocking anonymous access. Outform does not connect accounts or read browser cookies. Try another public post or retry later.",
      url,
      "LOGIN_REQUIRED",
    );
  if (/\b403\b|forbidden|access denied/i.test(stderr))
    return mediaError(
      "The site denied access to this media. It may be restricted, temporarily blocked, or its download link may have expired. Retry the original post URL later; this does not necessarily mean the post is private.",
      url,
      "MEDIA_RESTRICTED",
    );
  if (
    /timed? out|timeout|connection reset|unable to download webpage|network is unreachable|name resolution|ENOTFOUND|ECONNRESET/i.test(
      stderr,
    )
  )
    return mediaError(
      "Could not reach the media server. Check your connection and retry later; the site may be temporarily unavailable.",
      url,
    );
  return mediaError(
    "Outform could not read this site's media. The site may have changed or blocked the request; the exact reason is unknown. Retry later. If it persists, report the public post URL with outform feedback.",
    url,
  );
}

async function runDownloader(args: string[], url: string, timeoutMs = 90_000): Promise<string> {
  const proc = spawn([
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
  ]);
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    proc.kill();
  }, timeoutMs);
  try {
    const result = await waitForResult(proc);
    if (expired) throw mediaError(`Media request timed out after ${timeoutMs / 1000} seconds. Retry later.`, url);
    if (result.exitCode !== 0) throw sourceFailure(result.stderr, url);
    return result.stdout;
  } finally {
    clearTimeout(timer);
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
    const direct = [...formats]
      .reverse()
      .find(
        (f) =>
          (kind === "audio" || f.vcodec !== "none") &&
          f.acodec !== "none" &&
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
    uploadDate: /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : null,
    media,
    directory: null,
    issues,
  };
}

export function parseTikTokSlides(html: string): Info[] {
  const script = html.match(
    /<script\b[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  if (!script) return [];
  const data = JSON.parse(script);
  const item = data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
  if (!record(item) || item.privateItem === true || item.takeDown === true) return [];
  const post = record(item.imagePost) ? item.imagePost : {};
  return records(post.images).map((image, index) => {
    const urls = record(image.imageURL) && Array.isArray(image.imageURL.urlList) ? image.imageURL.urlList : [];
    return {
      id: `${text(item.id)}-${index + 1}`,
      outform_image: true,
      thumbnails: urls.filter(httpUrl).map((url) => ({ url, width: image.imageWidth, height: image.imageHeight })),
    };
  });
}

export function parsePinterestGallery(data: Info): Info[] | null {
  const story = record(data.story_pin_data) ? data.story_pin_data : {};
  if (!Array.isArray(story.pages)) return null;
  const entries: Info[] = [];
  for (const [pageIndex, page] of story.pages.entries()) {
    if (!record(page)) {
      entries.push({});
      continue;
    }
    // Page videos contain the composed scene. Otherwise preserve each original media block.
    const blocks = record(page.video) ? [page] : records(page.blocks);
    if (!blocks.length) {
      entries.push({});
      continue;
    }
    for (const [blockIndex, block] of blocks.entries()) {
      const id = `${text(data.id)}-${pageIndex + 1}-${blockIndex + 1}`;
      const video = record(block.video) ? block.video : {};
      const variants = record(video.video_list) ? Object.values(video.video_list).filter(record) : [];
      if (variants.length) {
        const formats = variants
          .filter((v) => httpUrl(v.url) && text(v.url).split("?")[0]?.endsWith(".mp4"))
          .sort((a, b) => (number(a.width) ?? 0) - (number(b.width) ?? 0))
          .map((v, i) => ({ ...v, format_id: String(i), ext: "mp4", protocol: "https" }));
        entries.push({
          id,
          title: id,
          formats,
          extractor: "Pinterest",
          webpage_url: `https://www.pinterest.com/pin/${text(data.id)}/`,
        });
      } else {
        const image = record(block.image) ? block.image : {};
        const images = record(image.images) ? image.images : {};
        const original = record(images.originals) ? images.originals : {};
        entries.push({
          id,
          outform_image: true,
          thumbnail: original.url,
          thumbnails: Object.values(images).filter(record),
        });
      }
    }
  }
  if ((number(story.page_count) ?? 0) > story.pages.length) entries.push({});
  return entries;
}

async function fetchMediaPage(input: string | URL, headers: Record<string, string>, source: string): Promise<string> {
  let response: Response;
  try {
    response = await publicFetch(input, { headers, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw mediaError(
      "Could not reach the media page. Check your connection and retry later; only public media servers are allowed.",
      source,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw sourceFailure(`HTTP ${response.status}`, source);
  }
  try {
    return await response.text();
  } catch {
    throw mediaError("The media page could not be read completely. Retry the original post URL later.", source);
  }
}

async function loadMedia(url: string, logger: ExtractLogger): Promise<{ result: MediaResult; entries: Info[] }> {
  const platform = mediaPlatform(url);
  if (!platform)
    throw mediaError(
      "Use a post or video URL from Instagram, X/Twitter, TikTok, Pinterest, Facebook, Reddit, Vimeo, or YouTube.",
      url,
    );
  if (!(await hasCommand("yt-dlp")))
    throw new OutformError(
      missingDependencyIssue({
        capability: "media",
        dependency: "yt-dlp",
        setupTarget: "youtube",
        installHints: ["outform install"],
        url,
        urlType: "media",
      }),
    );
  if (platform === "youtube" && !(await hasCommand("deno")))
    throw new OutformError(
      missingDependencyIssue({
        capability: "media",
        dependency: "deno",
        setupTarget: "youtube",
        installHints: ["outform install youtube"],
        url,
        urlType: "media",
      }),
    );
  let request = url;
  if (platform === "tiktok") request = url.replace(/\/photo\/(\d+)/, "/video/$1");
  if (platform === "vimeo" && new URL(url).hostname !== "player.vimeo.com") {
    const [, id, hash] = new URL(url).pathname.split("/");
    const player = new URL(`https://player.vimeo.com/video/${id}`);
    if (hash) player.searchParams.set("h", hash);
    request = player.href;
  }
  const extras =
    platform === "youtube" ? ["--no-playlist", "--no-js-runtimes", "--js-runtimes", `deno:${toolPath("deno")}`] : [];
  logProgress(`Reading public ${platform} media...`, logger);
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
  );
  let info: unknown;
  try {
    info = JSON.parse(output);
  } catch {
    throw mediaError("The media downloader returned invalid metadata.", url);
  }
  if (!record(info)) throw mediaError("The site returned no public media metadata.", url);
  if (platform === "tiktok" && (/\/photo\//.test(url) || records(info.formats).every((f) => f.vcodec === "none"))) {
    const html = await fetchMediaPage(httpUrl(info.webpage_url) ?? request, { "User-Agent": "Mozilla/5.0" }, url);
    let slides: Info[];
    try {
      slides = parseTikTokSlides(html);
    } catch {
      throw mediaError(
        "TikTok returned unreadable photo metadata. Retry later; if it persists, report the public post URL with outform feedback.",
        url,
      );
    }
    if (!slides.length)
      throw mediaError("TikTok did not expose this photo post anonymously. No slideshow images were downloaded.", url);
    // A photo post's sole yt-dlp format is its soundtrack, not a video of the slides.
    info.entries = [...slides, ...(records(info.formats).length ? [{ ...info, entries: undefined }] : [])];
  }
  if (platform === "pinterest" && /^\d+$/.test(text(info.id))) {
    const endpoint = new URL("https://www.pinterest.com/resource/PinResource/get/");
    endpoint.searchParams.set(
      "data",
      JSON.stringify({ options: { id: info.id, field_set_key: "unauth_react_main_pin" } }),
    );
    const body = await fetchMediaPage(
      endpoint,
      { "User-Agent": "Mozilla/5.0", "X-Pinterest-PWS-Handler": "www/[username].js" },
      url,
    );
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw mediaError(
        "Pinterest returned unreadable gallery metadata. Retry later; if it persists, report the public post URL with outform feedback.",
        url,
      );
    }
    const data = record(payload) && record(payload.resource_response) ? payload.resource_response.data : null;
    if (!record(data)) throw mediaError("Pinterest did not expose the post's media list anonymously.", url);
    const gallery = parsePinterestGallery(data);
    if (gallery) info.entries = gallery;
  }
  const raw = Array.isArray(info.entries) ? info.entries : [info];
  if (raw.length > 50 || (number(info.playlist_count) ?? 0) > 50)
    throw mediaError("Use a single post with at most 50 media items, rather than a collection or profile.", url);
  const result = parseMediaInfo(info, url, platform);
  if (!result.media.length) throw mediaError("This post has no publicly downloadable images, video, or audio.", url);
  return { result, entries: raw.map((entry) => (record(entry) ? entry : {})) };
}

export async function extractMedia(url: string, logger: ExtractLogger = silentLogger): Promise<MediaResult> {
  return (await loadMedia(url, logger)).result;
}

async function downloadImage(asset: MediaAsset, directory: string, referer: string): Promise<string> {
  if (!asset.url) throw new Error("No image URL was returned.");
  const response = await publicFetch(asset.url, {
    headers: { "User-Agent": "Mozilla/5.0", Referer: referer },
    signal: AbortSignal.timeout(60_000),
  });
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
  };
  const extension = extensions[mime];
  if (!response.ok || !response.body || !extension) {
    await response.body?.cancel();
    if (!response.ok) throw sourceFailure(`HTTP ${response.status}`, referer);
    throw new Error(
      `The site returned ${mime || "an unknown content type"} instead of an image. It may be an access-check page. Retry the original post URL later.`,
    );
  }
  const file = join(directory, `media.${extension}`);
  let received = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      callback(received > 50 * 1024 * 1024 ? new Error("Image exceeds 50 MB.") : null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    limit,
    createWriteStream(file, { flags: "wx" }),
  );
  if (!received) throw new Error("The image response was empty.");
  const length = Number(response.headers.get("content-length"));
  if (length && length !== received) throw new Error("The image download was incomplete.");
  return file;
}

export async function downloadMedia(
  url: string,
  directory: string,
  logger: ExtractLogger = silentLogger,
): Promise<MediaResult> {
  const { result, entries } = await loadMedia(url, logger);
  if (result.media.some((asset) => asset.kind !== "image") && !(await hasCommand("ffmpeg"))) {
    throw new OutformError(
      missingDependencyIssue({
        capability: "media",
        dependency: "ffmpeg",
        setupTarget: "ffmpeg",
        installHints: ["outform install"],
        url,
        urlType: "media",
      }),
    );
  }
  await mkdir(resolve(directory), { recursive: true });
  const safeId = result.id.replace(/[^\w-]/g, "_").slice(0, 80) || "post";
  result.directory = await mkdtemp(join(resolve(directory), `${result.platform}-${safeId}-`));
  for (const asset of result.media) {
    const stage = await mkdtemp(join(result.directory, ".download-"));
    try {
      logProgress(`Downloading ${asset.kind} ${asset.index}/${entries.length}...`, logger);
      let file: string;
      if (asset.kind === "image") {
        const variants = records(entries[asset.index - 1]?.thumbnails)
          .reverse()
          .sort(
            (a, b) =>
              (number(b.width) ?? 0) * (number(b.height) ?? 0) - (number(a.width) ?? 0) * (number(a.height) ?? 0),
          );
        const urls = [
          ...new Set(
            [asset.url, ...variants.map((item) => httpUrl(item.url))].filter((value): value is string => !!value),
          ),
        ];
        let saved: string | undefined;
        let failure: unknown = new Error("No image URL was returned.");
        for (const imageUrl of urls) {
          try {
            saved = await downloadImage({ ...asset, url: imageUrl }, stage, url);
            asset.url = imageUrl;
            const selected = variants.find((item) => item.url === imageUrl);
            asset.width = number(selected?.width);
            asset.height = number(selected?.height);
            break;
          } catch (error) {
            if (error instanceof OutformError && error.code === "RATE_LIMITED") throw error;
            failure = error;
            for (const name of await readdir(stage)) await rm(join(stage, name), { force: true });
          }
        }
        if (!saved) throw failure;
        file = saved;
      } else {
        const info = { ...entries[asset.index - 1] };
        for (const key of ["entries", "_filename", "filename", "filepath", "requested_downloads", "__files_to_move"])
          delete info[key];
        await writeFile(join(stage, "info.json"), JSON.stringify(info));
        await runDownloader(
          [
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
          15 * 60_000,
        );
        const names = (await readdir(stage)).filter((name) =>
          /^media\.(?:mp4|mkv|webm|mov|m4a|mp3|aac|ogg|opus|flv)$/.test(name),
        );
        if (names.length !== 1) throw new Error("Downloader did not produce a complete media file.");
        file = join(stage, names[0]!);
      }
      if (!(await stat(file)).size) throw new Error("Downloaded file is empty.");
      const destination = join(
        result.directory,
        `${String(asset.index).padStart(3, "0")}-${asset.id.replace(/[^\w-]/g, "_").slice(0, 80)}${extname(file)}`,
      );
      await rename(file, destination);
      asset.file = destination;
    } catch (error) {
      const failure = OutformError.fromUnknown(error, {
        code: "DOWNLOAD_FAILED",
        capability: "media",
        urlType: "media",
        url,
        message: "The download could not be completed. Retry the original post URL later.",
      });
      result.issues.push({ ...failure.issue, message: `Item ${asset.index}: ${failure.message}` });
      if (failure.code === "RATE_LIMITED") {
        result.issues[result.issues.length - 1]!.message += " Remaining items were not attempted.";
        break;
      }
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  await writeFile(
    join(result.directory, "metadata.json"),
    JSON.stringify({ type: "media", ...result }, null, 2) + "\n",
  );
  return result;
}
