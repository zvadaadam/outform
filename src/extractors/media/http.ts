import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { publicFetch } from "../../utils/public-fetch";
import type { MediaSaveOptions } from "./metadata";
import { mediaError, mediaSourceFailure } from "../../errors";

export async function fetchMediaPage(
  input: string | URL,
  headers: Record<string, string>,
  source: string,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await publicFetch(input, {
      headers,
      signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
    });
  } catch {
    signal?.throwIfAborted();
    throw mediaError(
      "Could not reach the media page. Check your connection and retry later; only public media servers are allowed.",
      source,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw mediaSourceFailure(`HTTP ${response.status}`, source);
  }
  try {
    return await response.text();
  } catch {
    signal?.throwIfAborted();
    throw mediaError("The media page could not be read completely. Retry the original post URL later.", source);
  }
}

export async function downloadHttpMedia(
  url: string,
  kind: "image" | "audio",
  directory: string,
  referer: string,
  options: MediaSaveOptions = {},
): Promise<string> {
  const response = await publicFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Referer: referer },
    signal: AbortSignal.any([
      AbortSignal.timeout(kind === "image" ? 60_000 : (options.timeoutMs ?? 15 * 60_000)),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const extensions: Record<string, string> =
    kind === "image"
      ? {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
          "image/gif": "gif",
          "image/avif": "avif",
        }
      : {
          "audio/mpeg": "mp3",
          "audio/mp3": "mp3",
          "audio/mp4": "m4a",
          "audio/aac": "aac",
          "audio/ogg": "ogg",
          "audio/flac": "flac",
          "audio/wav": "wav",
        };
  const extension = extensions[mime];
  if (!response.ok || !response.body || !extension) {
    await response.body?.cancel();
    if (!response.ok) throw mediaSourceFailure(`HTTP ${response.status}`, referer);
    throw new Error(
      `The site returned ${mime || "an unknown content type"} instead of ${kind}. It may be an access-check page. Retry the original post URL later.`,
    );
  }
  const file = join(directory, `media.${extension}`);
  let received = 0;
  const maxBytes = Math.min(kind === "image" ? 50 * 1024 * 1024 : Infinity, options.maxBytes ?? Infinity);
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      callback(
        received > maxBytes ? mediaError(`Media exceeds the ${maxBytes}-byte limit.`, referer, "LIMIT_EXCEEDED") : null,
        chunk,
      );
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    limit,
    createWriteStream(file, { flags: "wx" }),
    { signal: options.signal },
  );
  if (!received) throw new Error("The media response was empty.");
  const length = Number(response.headers.get("content-length"));
  if (length && length !== received) throw new Error("The media download was incomplete.");
  return file;
}
