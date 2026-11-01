import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { hasCommand } from "../utils/deps";
import { mediaPlatform, type MediaPlatform } from "../utils/url";
import { logProgress, silentLogger, type ExtractLogger } from "../utils/log";
import { OutformError, mediaError, missingDependencyIssue, invalidOptionsIssue } from "../errors";
import type { MediaResult, ResolvedMedia, MediaSaveOptions } from "./media/metadata";
import { loadYtDlpInfo, resolveYtDlpInfo, downloadYtDlpMedia } from "./media/yt-dlp";
import { resolveTikTok } from "./media/tiktok";
import { resolvePinterest } from "./media/pinterest";
import { resolveSpotify } from "./media/spotify";
import { downloadHttpMedia } from "./media/http";
import { checkFileSize, checkDuration, convertMediaAudio, hashMediaFile, verifyMediaFile } from "./media/audio";
export type { MediaAsset, MediaResult } from "./media/metadata";

export function mediaDependencies(platform: MediaPlatform | null): string[] {
  if (platform === "spotify") return [];
  return platform === "youtube" ? ["yt-dlp", "deno"] : ["yt-dlp"];
}

async function loadMedia(url: string, logger: ExtractLogger, signal?: AbortSignal): Promise<ResolvedMedia> {
  signal?.throwIfAborted();
  const platform = mediaPlatform(url);
  if (!platform)
    throw mediaError(
      "Use a post or video URL from Instagram, X/Twitter, TikTok, Pinterest, Spotify, Facebook, Reddit, Vimeo, or YouTube.",
      url,
    );
  for (const dependency of mediaDependencies(platform)) {
    if (!(await hasCommand(dependency)))
      throw new OutformError(
        missingDependencyIssue({
          capability: "media",
          dependency,
          setupTarget: "youtube",
          installHints: ["outform install youtube"],
          url,
          urlType: "media",
        }),
      );
  }
  logProgress(`Reading public ${platform} media...`, logger);
  switch (platform) {
    case "tiktok":
      return resolveTikTok(url, signal);
    case "pinterest":
      return resolvePinterest(url, signal);
    case "spotify":
      return resolveSpotify(url, signal);
    default:
      return resolveYtDlpInfo(await loadYtDlpInfo(url, platform, url, signal), url, platform);
  }
}

export async function extractMedia(url: string, logger: ExtractLogger = silentLogger): Promise<MediaResult> {
  return (await loadMedia(url, logger)).result;
}

function failureFor(error: unknown, source: string, signal?: AbortSignal): OutformError {
  if (signal?.aborted) {
    return signal.reason instanceof OutformError
      ? signal.reason
      : mediaError(
          "Download cancelled. Completed files are preserved; temporary files were removed.",
          source,
          "DOWNLOAD_CANCELLED",
        );
  }
  return OutformError.fromUnknown(error, {
    code: "DOWNLOAD_FAILED",
    capability: "media",
    urlType: "media",
    url: source,
    message: "The download could not be completed.",
  });
}

async function operation(
  source: string,
  options: MediaSaveOptions,
  run: (options: MediaSaveOptions & { signal: AbortSignal }) => Promise<MediaResult>,
) {
  for (const key of ["maxBytes", "maxDuration", "maxItems", "timeoutMs"] as const) {
    const value = options[key];
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value <= 0 || (key !== "maxDuration" && !Number.isSafeInteger(value)))
    )
      throw new OutformError(
        invalidOptionsIssue(`${key} must be a positive ${key === "maxDuration" ? "number" : "safe integer"}.`),
      );
  }
  if (options.output !== undefined && !["audio", "media"].includes(options.output))
    throw new OutformError(invalidOptionsIssue("output must be media or audio."));
  if (options.verification !== undefined && !["probe", "decode"].includes(options.verification))
    throw new OutformError(invalidOptionsIssue("verification must be probe or decode."));
  if (options.timeoutMs !== undefined && options.timeoutMs > 2_147_483_647)
    throw new OutformError(invalidOptionsIssue("timeoutMs must not exceed 2147483647."));
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const timer = setTimeout(
    () =>
      controller.abort(
        mediaError(`Download exceeded the ${timeoutMs}-millisecond time limit.`, source, "DOWNLOAD_TIMEOUT"),
      ),
    timeoutMs,
  );
  const signal = AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]);
  try {
    signal.throwIfAborted();
    return await run({ ...options, signal });
  } catch (error) {
    throw failureFor(error, source, signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadMedia(
  url: string,
  directory: string,
  logger: ExtractLogger = silentLogger,
  options: MediaSaveOptions = {},
): Promise<MediaResult> {
  return operation(url, options, async (controlled) =>
    saveMedia(await loadMedia(url, logger, controlled.signal), directory, logger, controlled),
  );
}

export async function convertAudioFile(
  input: string,
  directory: string,
  logger: ExtractLogger = silentLogger,
  options: MediaSaveOptions = {},
): Promise<MediaResult> {
  if (/^https?:\/\//i.test(input))
    throw new OutformError(
      invalidOptionsIssue('convertAudio accepts a local file. Use download(url, { output: "audio" }) for a URL.'),
    );
  const source = resolve(input);
  return operation(source, { ...options, output: "audio" }, async (controlled) => {
    const info = await stat(source);
    if (!info.isFile()) throw mediaError("Choose a local audio or video file.", source);
    const id = basename(source, extname(source));
    return saveMedia(
      {
        result: {
          platform: "local",
          id,
          title: basename(source),
          description: "",
          author: null,
          thumbnail: null,
          source,
          uploadDate: null,
          directory: null,
          issues: [],
          media: [
            {
              id,
              index: 1,
              kind: "audio",
              url: null,
              thumbnail: null,
              width: null,
              height: null,
              duration: null,
              file: null,
            },
          ],
        },
        transfers: new Map([[1, { type: "file", path: source }]]),
      },
      directory,
      logger,
      controlled,
    );
  });
}

async function saveMedia(
  { result, transfers }: ResolvedMedia,
  directory: string,
  logger: ExtractLogger,
  options: MediaSaveOptions & { signal: AbortSignal },
): Promise<MediaResult> {
  const url = result.source;
  if (!result.media.length)
    throw new OutformError(result.issues[0] ?? mediaError("No public media is available for download.", url).issue);
  if (options.output === "audio") {
    result.media = result.media.filter((asset) => asset.kind !== "image");
    if (!result.media.length)
      throw mediaError("This post contains no audio or video. Photos cannot be converted to MP3.", url);
  }
  if (options.maxItems !== undefined && result.media.length > options.maxItems)
    throw mediaError(`This post exceeds the ${options.maxItems}-item limit.`, url, "LIMIT_EXCEEDED");
  if (!result.media.length)
    throw new OutformError(result.issues[0] ?? mediaError("No public media is available for download.", url).issue);
  const nativeFiles = result.media.some((asset) => asset.kind !== "image");
  const needsFfmpeg =
    options.output === "audio" ||
    (nativeFiles && options.verification === "decode") ||
    [...transfers.values()].some((transfer) => transfer.type === "yt-dlp");
  const canProbe = nativeFiles && (await hasCommand("ffprobe"));
  const missing =
    needsFfmpeg && !(await hasCommand("ffmpeg"))
      ? "ffmpeg"
      : nativeFiles &&
          !canProbe &&
          (options.output === "audio" || options.maxDuration !== undefined || options.verification === "decode")
        ? "ffprobe"
        : null;
  if (missing) {
    throw new OutformError(
      missingDependencyIssue({
        capability: "media",
        dependency: missing,
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
  const lastIndex = Math.max(...result.media.map((asset) => asset.index));
  for (const asset of result.media) {
    const stage = await mkdtemp(join(result.directory, ".download-"));
    try {
      options.signal.throwIfAborted();
      checkDuration(asset.duration, options, url);
      logProgress(
        `${result.platform === "local" ? "Converting" : "Downloading"} ${asset.kind} ${asset.index}/${lastIndex}...`,
        logger,
      );
      const transfer = transfers.get(asset.index);
      if (!transfer) throw new Error("No download instructions were returned for this item.");
      let file: string;
      if (transfer.type === "yt-dlp") file = await downloadYtDlpMedia(transfer.info, stage, url, options);
      else if (transfer.type === "file") file = transfer.path;
      else {
        if (asset.kind === "video") throw new Error("Direct video downloads are not supported by this provider.");
        let saved: string | undefined;
        let failure: unknown = new Error("No media URL was returned.");
        for (const candidate of transfer.candidates) {
          try {
            saved = await downloadHttpMedia(candidate.url, asset.kind, stage, url, options);
            asset.url = candidate.url;
            asset.width = candidate.width ?? null;
            asset.height = candidate.height ?? null;
            break;
          } catch (error) {
            options.signal.throwIfAborted();
            if (error instanceof OutformError && ["RATE_LIMITED", "LIMIT_EXCEEDED"].includes(error.code)) throw error;
            failure = error;
            for (const name of await readdir(stage)) await rm(join(stage, name), { force: true });
          }
        }
        if (!saved) throw failure;
        file = saved;
      }
      if (options.output === "audio") {
        await checkFileSize(file, options, url);
        const sourceHash = await hashMediaFile(file, options.signal);
        const converted = await convertMediaAudio(file, stage, url, options, options.signal);
        asset.sourceMedia = {
          kind: result.platform === "local" ? converted.original.kind : (asset.kind as "audio" | "video"),
          url: asset.url,
          width: result.platform === "local" ? converted.original.width : asset.width,
          height: result.platform === "local" ? converted.original.height : asset.height,
          duration: result.platform === "local" ? converted.original.duration : asset.duration,
        };
        asset.kind = "audio";
        asset.url = null;
        asset.width = null;
        asset.height = null;
        asset.duration = converted.artifact.duration;
        asset.artifact = { ...converted.artifact, inputSha256: sourceHash };
        file = converted.file;
      } else asset.artifact = await verifyMediaFile(file, asset.kind, url, options, options.signal, canProbe);
      options.signal.throwIfAborted();
      const destination = join(
        result.directory,
        `${String(asset.index).padStart(3, "0")}-${asset.id.replace(/[^\w-]/g, "_").slice(0, 80)}${extname(file)}`,
      );
      await rename(file, destination);
      asset.file = destination;
    } catch (error) {
      const failure = failureFor(error, url, options.signal);
      delete asset.artifact;
      result.issues.push({ ...failure.issue, message: `Item ${asset.index}: ${failure.message}` });
      if (["RATE_LIMITED", "DOWNLOAD_CANCELLED", "DOWNLOAD_TIMEOUT", "LIMIT_EXCEEDED"].includes(failure.code)) {
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
