import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn, waitForResult } from "../../utils/process";
import { mediaError } from "../../errors";
import { record, records, text, number, type MediaFileInfo, type MediaSaveOptions } from "./metadata";

const LOCAL_INPUT = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,matroska,webm,mp3,ogg,flac,wav,aac,avi,flv,mpeg,mpegts,asf,aiff",
];

async function run(command: string, args: string[], source: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const result = await waitForResult(spawn([command, ...args], { signal }));
  signal.throwIfAborted();
  if (result.exitCode !== 0)
    throw mediaError(
      `${command} could not read or process this media. The file may be corrupt or unsupported.`,
      source,
      "VERIFICATION_FAILED",
    );
  return result.stdout;
}

export async function hashMediaFile(file: string, signal: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest("hex");
}

export function checkDuration(duration: number | null, options: MediaSaveOptions, source: string) {
  if (options.maxDuration !== undefined && duration !== null && duration > options.maxDuration)
    throw mediaError(`Media duration exceeds the ${options.maxDuration}-second limit.`, source, "LIMIT_EXCEEDED");
}

export async function checkFileSize(file: string, options: MediaSaveOptions, source: string): Promise<number> {
  const info = await stat(file);
  if (!info.isFile() || !info.size)
    throw mediaError("The media file is empty or is not a regular file.", source, "VERIFICATION_FAILED");
  if (options.maxBytes !== undefined && info.size > options.maxBytes)
    throw mediaError(`Media exceeds the ${options.maxBytes}-byte limit.`, source, "LIMIT_EXCEEDED");
  return info.size;
}

async function readHeader(file: string): Promise<Buffer> {
  const handle = await open(file, "r");
  const header = Buffer.alloc(512);
  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function probeMediaFile(file: string, source: string, signal: AbortSignal) {
  const output = await run(
    "ffprobe",
    [
      "-v",
      "error",
      ...LOCAL_INPUT,
      "-show_entries",
      "format=format_name,duration:stream=codec_type,codec_name,width,height,duration,start_time:stream_disposition=attached_pic:stream_tags=DURATION",
      "-of",
      "json",
      file,
    ],
    source,
    signal,
  );
  let data: unknown;
  try {
    data = JSON.parse(output);
  } catch {
    throw mediaError("Media probe returned unreadable metadata.", source, "VERIFICATION_FAILED");
  }
  const streams = record(data) ? records(data.streams) : [];
  const video = streams.find(
    (s) => s.codec_type === "video" && !(record(s.disposition) && s.disposition.attached_pic === 1),
  );
  const audio = streams.find((s) => s.codec_type === "audio");
  const format = record(data) && record(data.format) ? data.format : {};
  const duration = Number(format.duration ?? audio?.duration);
  const tag = record(audio?.tags) ? text(audio.tags.DURATION) : "";
  const tagged = /^(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)$/.exec(tag);
  const streamDuration = Number(audio?.duration);
  const start = Number(audio?.start_time ?? 0);
  // Matroska's DURATION tag is the track's end timestamp, including any start offset.
  const taggedDuration = tagged
    ? +tagged[1]! * 3600 + +tagged[2]! * 60 + +tagged[3]! - (Number.isFinite(start) ? start : 0)
    : NaN;
  const audioDuration =
    Number.isFinite(streamDuration) && streamDuration > 0
      ? streamDuration
      : Number.isFinite(taggedDuration) && taggedDuration > 0
        ? taggedDuration
        : null;
  if ((!audio && !video) || !Number.isFinite(duration) || duration <= 0)
    throw mediaError("No playable audio or video with a valid duration was found.", source, "VERIFICATION_FAILED");
  const formats = text(format.format_name).split(",");
  const header = await readHeader(file);
  const docType = header.indexOf(Buffer.from([0x42, 0x82]));
  const ebml =
    docType < 0
      ? null
      : header[docType + 2] === 0x84 && header.toString("ascii", docType + 3, docType + 7) === "webm"
        ? "webm"
        : header[docType + 2] === 0x88 && header.toString("ascii", docType + 3, docType + 11) === "matroska"
          ? "x-matroska"
          : null;
  const quickTime = header.toString("ascii", 4, 12) === "ftypqt  ";
  let contentType = "application/octet-stream";
  if (formats.includes("mp3")) contentType = "audio/mpeg";
  else if (formats.includes("mov") || formats.includes("mp4"))
    contentType = quickTime ? "video/quicktime" : video ? "video/mp4" : "audio/mp4";
  else if ((formats.includes("matroska") || formats.includes("webm")) && ebml)
    contentType = `${video ? "video" : "audio"}/${ebml}`;
  else if (formats.includes("ogg")) contentType = video ? "video/ogg" : "audio/ogg";
  else if (formats.includes("flac")) contentType = "audio/flac";
  else if (formats.includes("wav")) contentType = "audio/wav";
  else if (formats.includes("aac")) contentType = "audio/aac";
  return {
    kind: video ? ("video" as const) : ("audio" as const),
    duration,
    audioDuration,
    width: number(video?.width),
    height: number(video?.height),
    hasAudio: !!audio,
    contentType,
  };
}

async function decode(file: string, source: string, signal: AbortSignal) {
  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-v",
      "error",
      "-xerror",
      "-nostdin",
      ...LOCAL_INPUT,
      "-i",
      file,
      "-map",
      "0:a?",
      "-map",
      "0:v?",
      "-f",
      "null",
      "-",
    ],
    source,
    signal,
  );
}

export async function convertMediaAudio(
  file: string,
  directory: string,
  source: string,
  options: MediaSaveOptions,
  signal: AbortSignal,
) {
  await checkFileSize(file, options, source);
  const original = await probeMediaFile(file, source, signal);
  if (!original.hasAudio)
    throw mediaError("This media has no audio track. Choose a video with sound or an audio file.", source);
  checkDuration(original.duration, options, source);
  const output = join(directory, "audio.mp3");
  if (original.contentType === "audio/mpeg" && original.kind === "audio") {
    await pipeline(createReadStream(file), createWriteStream(output, { flags: "wx" }), { signal });
  } else
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-v",
        "error",
        "-xerror",
        "-nostdin",
        ...LOCAL_INPUT,
        "-i",
        file,
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        ...(options.maxBytes === undefined ? [] : ["-fs", String(options.maxBytes + 1)]),
        "-n",
        output,
      ],
      source,
      signal,
    );
  const artifact = await verifyMediaFile(output, "audio", source, { ...options, verification: "decode" }, signal, true);
  const expectedDuration = original.audioDuration ?? (original.kind === "audio" ? original.duration : null);
  if (
    artifact.contentType !== "audio/mpeg" ||
    artifact.hasAudio !== true ||
    (expectedDuration !== null && Math.abs((artifact.duration ?? 0) - expectedDuration) > 0.25)
  )
    throw mediaError("The converted MP3 does not match the complete source audio.", source, "VERIFICATION_FAILED");
  return { file: output, original, artifact };
}

export async function verifyMediaFile(
  file: string,
  kind: "video" | "audio" | "image",
  source: string,
  options: MediaSaveOptions,
  signal: AbortSignal,
  canProbe: boolean,
): Promise<MediaFileInfo> {
  signal.throwIfAborted();
  const bytes = await checkFileSize(file, options, source);
  let contentType = "application/octet-stream";
  let width: number | null = null,
    height: number | null = null,
    duration: number | null = null;
  let hasAudio: boolean | null = null;
  let verification: MediaFileInfo["verification"] = "transport";
  if (kind === "image") {
    const header = await readHeader(file);
    if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) contentType = "image/png";
    else if (header[0] === 255 && header[1] === 216 && header[2] === 255) contentType = "image/jpeg";
    else if (/^GIF8[79]a/.test(header.toString("ascii", 0, 6))) contentType = "image/gif";
    else if (header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP")
      contentType = "image/webp";
    else if (header.toString("ascii", 4, 8) === "ftyp" && /avif|avis/.test(header.toString("ascii", 8)))
      contentType = "image/avif";
    else throw mediaError("The saved response is not a recognized image file.", source, "VERIFICATION_FAILED");
    verification = "signature";
  } else if (canProbe) {
    const probe = await probeMediaFile(file, source, signal);
    if (probe.kind !== kind)
      throw mediaError(`Expected ${kind}, but the saved file contains ${probe.kind}.`, source, "VERIFICATION_FAILED");
    ({ contentType, width, height, duration, hasAudio } = probe);
    checkDuration(
      duration,
      contentType === "audio/mpeg" && options.maxDuration !== undefined
        ? { ...options, maxDuration: options.maxDuration + 0.25 }
        : options,
      source,
    );
    verification = "probe";
    if (options.verification === "decode") {
      await decode(file, source, signal);
      verification = "decode";
    }
  }
  return {
    bytes,
    sha256: await hashMediaFile(file, signal),
    contentType,
    width,
    height,
    duration,
    hasAudio,
    verification,
  };
}
