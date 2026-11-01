import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { hasCommand } from "../utils/deps";
import { mediaPlatform, type MediaPlatform } from "../utils/url";
import { logProgress, silentLogger, type ExtractLogger } from "../utils/log";
import { OutformError, mediaError, missingDependencyIssue } from "../errors";
import type { MediaResult, ResolvedMedia } from "./media/metadata";
import { loadYtDlpInfo, resolveYtDlpInfo, downloadYtDlpMedia } from "./media/yt-dlp";
import { resolveTikTok } from "./media/tiktok";
import { resolvePinterest } from "./media/pinterest";
import { resolveSpotify } from "./media/spotify";
import { downloadHttpMedia } from "./media/http";
export type { MediaAsset, MediaResult } from "./media/metadata";

export function mediaDependencies(platform: MediaPlatform | null): string[] {
  if (platform === "spotify") return [];
  return platform === "youtube" ? ["yt-dlp", "deno"] : ["yt-dlp"];
}

async function loadMedia(url: string, logger: ExtractLogger): Promise<ResolvedMedia> {
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
      return resolveTikTok(url);
    case "pinterest":
      return resolvePinterest(url);
    case "spotify":
      return resolveSpotify(url);
    default:
      return resolveYtDlpInfo(await loadYtDlpInfo(url, platform), url, platform);
  }
}

export async function extractMedia(url: string, logger: ExtractLogger = silentLogger): Promise<MediaResult> {
  return (await loadMedia(url, logger)).result;
}

export async function downloadMedia(
  url: string,
  directory: string,
  logger: ExtractLogger = silentLogger,
): Promise<MediaResult> {
  const { result, transfers } = await loadMedia(url, logger);
  if (!result.media.length)
    throw new OutformError(result.issues[0] ?? mediaError("No public media is available for download.", url).issue);
  if ([...transfers.values()].some((transfer) => transfer.type === "yt-dlp") && !(await hasCommand("ffmpeg"))) {
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
  const lastIndex = Math.max(...result.media.map((asset) => asset.index));
  for (const asset of result.media) {
    const stage = await mkdtemp(join(result.directory, ".download-"));
    try {
      logProgress(`Downloading ${asset.kind} ${asset.index}/${lastIndex}...`, logger);
      const transfer = transfers.get(asset.index);
      if (!transfer) throw new Error("No download instructions were returned for this item.");
      let file: string;
      if (transfer.type === "yt-dlp") file = await downloadYtDlpMedia(transfer.info, stage, url);
      else {
        if (asset.kind === "video") throw new Error("Direct video downloads are not supported by this provider.");
        let saved: string | undefined;
        let failure: unknown = new Error("No media URL was returned.");
        for (const candidate of transfer.candidates) {
          try {
            saved = await downloadHttpMedia(candidate.url, asset.kind, stage, url);
            asset.url = candidate.url;
            asset.width = candidate.width ?? null;
            asset.height = candidate.height ?? null;
            break;
          } catch (error) {
            if (error instanceof OutformError && error.code === "RATE_LIMITED") throw error;
            failure = error;
            for (const name of await readdir(stage)) await rm(join(stage, name), { force: true });
          }
        }
        if (!saved) throw failure;
        file = saved;
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
