import { afterEach, describe, expect, test } from "bun:test";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { hasManagedTool, toolPath } from "../../src/utils/process";
import { createManagedTools } from "../fixtures/tools";

const real = { ffmpeg: toolPath("ffmpeg"), ffprobe: toolPath("ffprobe"), "yt-dlp": toolPath("yt-dlp") };
const available =
  process.platform !== "win32" &&
  (await hasManagedTool("ffmpeg")) &&
  (await hasManagedTool("ffprobe")) &&
  (await hasManagedTool("yt-dlp"));
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const source = "https://www.instagram.com/p/test/";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(metadata: unknown = {}, stall: false | "download" | "conversion" = false) {
  const stalled = `printf ready > "$OUTFORM_TEST_READY"
(sleep 2; printf orphan > "$OUTFORM_TEST_ORPHAN") &
sleep 30`;
  const f = await createManagedTools(["yt-dlp", "ffmpeg", "ffprobe"], {
    ffmpeg: `#!/bin/sh\n${stall === "conversion" ? `case " $* " in *" libx264 "*) ${stalled}; exit 0;; esac\n` : ""}exec ${quote(real.ffmpeg)} "$@"\n`,
    ffprobe: `#!/bin/sh\nexec ${quote(real.ffprobe)} "$@"\n`,
    "yt-dlp": `#!/bin/sh
for arg in "$@"; do
 if [ "$arg" = '--dump-single-json' ]; then /bin/cat "$OUTFORM_TEST_METADATA"; exit 0; fi
done
${stall === "download" ? stalled : `exec ${quote(real["yt-dlp"])} "$@"`}
`,
  });
  roots.push(f.root);
  const metadataPath = join(f.root, "metadata.json");
  await writeFile(metadataPath, JSON.stringify(metadata));
  const env = {
    ...process.env,
    ...f.env,
    OUTFORM_TEST_METADATA: metadataPath,
    OUTFORM_TEST_READY: join(f.root, "ready"),
    OUTFORM_TEST_ORPHAN: join(f.root, "orphan"),
  };
  const output = join(f.root, "output");
  const spawn = (args: string[]) => Bun.spawn([process.execPath, ...args], { env, stdout: "pipe", stderr: "pipe" });
  const collect = async (proc: ReturnType<typeof spawn>) => {
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { data: JSON.parse(stdout), stderr, exit };
  };
  const run = (args: string[]) => collect(spawn(args));
  return { ...f, env, output, run, spawn, collect, metadataPath };
}
async function ffmpeg(args: string[]) {
  const proc = Bun.spawn([real.ffmpeg, "-hide_banner", "-v", "error", ...args], { stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  if (await proc.exited) throw new Error(stderr);
}
async function streamInfo(file: string) {
  const proc = Bun.spawn([real.ffprobe, "-v", "error", "-show_streams", "-of", "json", file], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).json();
  expect(await proc.exited).toBe(0);
  return output.streams as {
    codec_type: string;
    codec_name: string;
    pix_fmt?: string;
    color_transfer?: string;
    color_primaries?: string;
    width?: number;
    height?: number;
  }[];
}
async function videoHash(file: string) {
  const proc = Bun.spawn(
    [real.ffmpeg, "-v", "error", "-i", file, "-map", "0:v:0", "-c", "copy", "-f", "hash", "-hash", "sha256", "-"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const hash = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return hash;
}
async function generated(root: string) {
  const audio = join(root, "source.m4a"),
    video = join(root, "source.mp4"),
    silent = join(root, "silent.mp4");
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "aac", audio]);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=red:size=64x64:rate=10:duration=2",
    "-i",
    audio,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    video,
  ]);
  await ffmpeg(["-i", video, "-an", "-c:v", "copy", silent]);
  return { audio, video, silent };
}
const videoInfo = (id: string, url: string) => ({
  id,
  title: id,
  extractor: "Generic",
  extractor_key: "Generic",
  webpage_url: source,
  duration: 2,
  width: 64,
  height: 64,
  formats: [
    { format_id: "combined", url, ext: "mp4", protocol: "http", vcodec: "h264", acodec: "aac", width: 64, height: 64 },
  ],
});

describe.skipIf(!available)("native media exports and local conversion", () => {
  test.each(["smpte2084", "arib-std-b67"])(
    "maps %s HDR to SDR when exporting compatible MP4",
    async (transfer) => {
      const f = await fixture();
      const file = join(f.root, "hdr.mkv");
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=64x64:rate=10:duration=2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p10le",
        "-color_primaries",
        "bt2020",
        "-color_trc",
        transfer,
        "-colorspace",
        "bt2020nc",
        file,
      ]);
      const server = Bun.serve({ port: 0, fetch: () => new Response(Bun.file(file)) });
      try {
        const info = videoInfo("hdr", server.url.href);
        info.formats[0] = { ...info.formats[0]!, ext: "mkv", acodec: "none" };
        await writeFile(f.metadataPath, JSON.stringify(info));
        const result = await f.run(["src/bin.ts", "download", source, "--output", f.output, "--json"]);
        expect(result.data.issues).toEqual([]);
        const asset = result.data.media[0];
        expect((await streamInfo(asset.file))[0]).toMatchObject({
          codec_name: "h264",
          pix_fmt: "yuv420p",
          color_transfer: "bt709",
          color_primaries: "bt709",
        });
        await ffmpeg(["-xerror", "-i", asset.file, "-f", "null", "-"]);
      } finally {
        server.stop(true);
      }
    },
    30_000,
  );

  test("MP4 conversion respects output byte limits and can be cancelled with its descendants", async () => {
    const f = await fixture();
    const file = join(f.root, "compact.webm");
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=size=64x64:rate=10:duration=5",
      "-f",
      "lavfi",
      "-i",
      "sine=duration=5",
      "-c:v",
      "libvpx-vp9",
      "-c:a",
      "libopus",
      "-b:a",
      "6k",
      file,
    ]);
    const bytes = await readFile(file);
    const server = Bun.serve({ port: 0, fetch: () => new Response(bytes) });
    try {
      const info = videoInfo("compact", server.url.href);
      info.duration = 5;
      info.formats[0] = { ...info.formats[0]!, ext: "webm", vcodec: "vp9", acodec: "opus" };
      await writeFile(f.metadataPath, JSON.stringify(info));
      const limited = await f.run([
        "-e",
        `import {download} from './src/index.ts';console.log(JSON.stringify((await download(${JSON.stringify(source)},${JSON.stringify({ directory: f.output, maxBytes: bytes.length + 1024 })})).json));`,
      ]);
      expect(limited.data.issues[0].code).toBe("LIMIT_EXCEEDED");
      expect(limited.data.media[0].file).toBeNull();
      expect(await readdir(limited.data.directory)).toEqual(["metadata.json"]);

      const stalled = await fixture(info, "conversion");
      const proc = stalled.spawn(["src/bin.ts", "download", source, "--output", stalled.output, "--json"]);
      for (let i = 0; i < 300 && !(await Bun.file(stalled.env.OUTFORM_TEST_READY).exists()); i++) await Bun.sleep(20);
      expect(await Bun.file(stalled.env.OUTFORM_TEST_READY).exists()).toBe(true);
      proc.kill("SIGINT");
      const cancelled = await stalled.collect(proc);
      expect(cancelled.exit).toBe(130);
      expect(cancelled.data.issues[0].code).toBe("DOWNLOAD_CANCELLED");
      expect(await readdir(cancelled.data.directory)).toEqual(["metadata.json"]);
      await Bun.sleep(2200);
      expect(await Bun.file(stalled.env.OUTFORM_TEST_ORPHAN).exists()).toBe(false);
    } finally {
      server.stop(true);
    }
  }, 30_000);

  test.each([
    [false, "mp4"],
    [true, "mp4"],
    [false, "mkv"],
  ] as const)(
    "preserves compatible streams (full range: %s, claimed extension: %s) over a stale metadata selection",
    async (fullRange, claimedExtension) => {
      const f = await fixture();
      const input = await generated(f.root);
      const compatible = fullRange ? join(f.root, "full-range.mp4") : input.video;
      if (fullRange)
        await ffmpeg(["-i", input.video, "-c:v", "libx264", "-color_range", "pc", "-c:a", "copy", compatible]);
      expect((await streamInfo(compatible))[0]?.pix_fmt).toBe(fullRange ? "yuvj420p" : "yuv420p");
      const requests: string[] = [];
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const path = new URL(req.url).pathname;
          requests.push(path);
          return path === "/compatible.mp4"
            ? new Response(Bun.file(compatible))
            : new Response("Wrong stream", { status: 404 });
        },
      });
      try {
        const info = videoInfo("selection", new URL("/compatible.mp4", server.url).href);
        info.formats[0]!.ext = claimedExtension;
        const incompatible = {
          ...info.formats[0],
          format_id: "webm",
          url: new URL("/wrong.webm", server.url).href,
          ext: "webm",
          vcodec: "vp9",
          acodec: "opus",
        };
        info.formats.push(incompatible);
        await writeFile(
          f.metadataPath,
          JSON.stringify({ ...info, ...incompatible, id: info.id, requested_formats: [incompatible] }),
        );
        const result = await f.run([
          "src/bin.ts",
          "download",
          source,
          "--format",
          "mp4",
          "--output",
          f.output,
          "--json",
        ]);
        expect(result.data.issues).toEqual([]);
        expect(result.exit).toBe(0);
        const asset = result.data.media[0];
        expect(asset.file).toEndWith(".mp4");
        expect(asset.artifact.contentType).toBe("video/mp4");
        if (claimedExtension === "mp4") expect(await readFile(asset.file)).toEqual(await readFile(compatible));
        else expect(await videoHash(asset.file)).toBe(await videoHash(compatible));
        expect(requests.length).toBeGreaterThan(0);
        expect(requests.every((path) => path === "/compatible.mp4")).toBe(true);
      } finally {
        server.stop(true);
      }
    },
    30_000,
  );

  test.each([
    ["mkv", "h264", "aac", false],
    ["mkv", "h264", "opus", false],
    ["webm", "vp9", "opus", false],
    ["webm", "vp9", "none", false],
    ["webm", "vp9", "opus", true],
  ] as const)(
    "exports %s %s/%s (original: %s) with honest codecs, duration and metadata",
    async (ext, videoCodec, audioCodec, original) => {
      const f = await fixture();
      const input = await generated(f.root);
      const file = join(f.root, `source.${ext}`);
      await ffmpeg([
        "-i",
        input.video,
        "-c:v",
        videoCodec === "h264" ? "copy" : "libvpx-vp9",
        ...(audioCodec === "none" ? ["-an"] : ["-c:a", audioCodec === "aac" ? "copy" : "libopus"]),
        file,
      ]);
      const server = Bun.serve({ port: 0, fetch: () => new Response(Bun.file(file)) });
      try {
        const info = videoInfo("export", server.url.href);
        info.formats[0] = { ...info.formats[0]!, ext, vcodec: videoCodec, acodec: audioCodec };
        // Simulate metadata for a higher-quality source variant; saved dimensions must describe the file.
        info.width = 1920;
        info.height = 1080;
        await writeFile(f.metadataPath, JSON.stringify(info));
        const result = await f.run([
          "src/bin.ts",
          "download",
          source,
          ...(original ? ["--format", "original"] : []),
          "--output",
          f.output,
          "--json",
        ]);
        expect(result.data.issues).toEqual([]);
        expect(result.exit).toBe(0);
        const asset = result.data.media[0];
        const bytes = await readFile(asset.file);
        expect(asset.artifact.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
        expect(asset.artifact.bytes).toBe(bytes.length);
        if (original) {
          expect(asset.file).toEndWith(".webm");
          expect(bytes).toEqual(await readFile(file));
          expect(asset.artifact.contentType).toBe("video/webm");
          expect(asset.sourceMedia).toBeUndefined();
        } else {
          expect(asset.file).toEndWith(".mp4");
          expect(asset.width).toBe(64);
          expect(asset.height).toBe(64);
          expect(asset.artifact.duration).toBeCloseTo(2, 0);
          expect(asset.artifact.contentType).toBe("video/mp4");
          expect(asset.artifact.hasAudio).toBe(audioCodec !== "none");
          expect(asset.url).toBeNull();
          expect(asset.sourceMedia).toMatchObject({ kind: "video", width: 1920, height: 1080 });
          expect(asset.artifact.inputSha256).toBe(
            createHash("sha256")
              .update(await readFile(file))
              .digest("hex"),
          );
          const streams = await streamInfo(asset.file);
          expect(streams.find((s) => s.codec_type === "video")).toMatchObject({
            codec_name: "h264",
            pix_fmt: "yuv420p",
          });
          expect(streams.find((s) => s.codec_type === "audio")?.codec_name).toBe(
            audioCodec === "none" ? undefined : "aac",
          );
          if (videoCodec === "h264") expect(await videoHash(asset.file)).toBe(await videoHash(file));
        }
        await ffmpeg(["-xerror", "-i", asset.file, "-f", "null", "-"]);
        expect(await readdir(result.data.directory)).toHaveLength(2);
        expect(JSON.parse(await readFile(join(result.data.directory, "metadata.json"), "utf8"))).toEqual(result.data);
      } finally {
        server.stop(true);
      }
    },
    30_000,
  );

  test("default audio exports produce MP3 and explicit MP3 skips photos", async () => {
    const f = await fixture();
    const input = await generated(f.root);
    const server = Bun.serve({ port: 0, fetch: () => new Response(Bun.file(input.audio)) });
    try {
      const info = videoInfo("sound", server.url.href);
      info.formats[0] = { ...info.formats[0]!, vcodec: "none", ext: "m4a" };
      await writeFile(f.metadataPath, JSON.stringify(info));
      const result = await f.run(["src/bin.ts", "download", source, "--output", f.output, "--json"]);
      expect(result.data.issues).toEqual([]);
      expect(result.data.media[0].file).toEndWith(".mp3");
      expect(result.data.media[0].artifact).toMatchObject({ contentType: "audio/mpeg", verification: "decode" });
      await writeFile(
        f.metadataPath,
        JSON.stringify({
          id: "mixed",
          entries: [{ id: "photo", thumbnails: [{ url: "https://cdn.example/photo.jpg" }] }, info],
        }),
      );
      const mp3 = await f.run(["src/bin.ts", "download", source, "--format", "mp3", "--output", f.output, "--json"]);
      expect(mp3.exit).toBe(0);
      expect(mp3.data.media).toHaveLength(1);
      expect(mp3.data.media[0].index).toBe(2);
      expect(mp3.data.media[0].file).toEndWith(".mp3");
    } finally {
      server.stop(true);
    }
  }, 30_000);

  test.each([
    [false, undefined],
    [true, undefined],
    [false, 1_000_000],
  ] as const)(
    "downloads complete HLS with bounded concurrency (missing: %s, maxBytes: %s)",
    async (missing, maxBytes) => {
      const f = await fixture();
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=red:size=64x64:rate=10:duration=8",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=8",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "10",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-f",
        "hls",
        "-hls_time",
        "1",
        "-hls_list_size",
        "0",
        "-hls_segment_filename",
        join(f.root, "segment%03d.ts"),
        join(f.root, "source.m3u8"),
      ]);
      let active = 0;
      let peak = 0;
      const server = Bun.serve({
        port: 0,
        async fetch(request) {
          const name = new URL(request.url).pathname.slice(1);
          if (name !== "source.m3u8" && !/^segment\d{3}\.ts$/.test(name))
            return new Response("Not found", { status: 404 });
          if (name.endsWith(".ts")) {
            peak = Math.max(peak, ++active);
            await Bun.sleep(200);
            active--;
          }
          if (missing && name === "segment002.ts") return new Response("Not found", { status: 404 });
          return new Response(Bun.file(join(f.root, name)));
        },
      });
      try {
        const info = videoInfo("segmented", new URL("source.m3u8", server.url).href);
        info.duration = 8;
        info.formats[0]!.protocol = "m3u8_native";
        await writeFile(f.metadataPath, JSON.stringify(info));
        const result = await f.run(
          maxBytes === undefined
            ? ["src/bin.ts", "download", source, "--output", f.output, "--json"]
            : [
                "-e",
                `import {download} from './src/index.ts'; const r = await download(${JSON.stringify(source)}, ${JSON.stringify({ directory: f.output, maxBytes })}); console.log(JSON.stringify(r.json));`,
              ],
        );
        if (maxBytes === undefined) {
          expect(peak).toBeGreaterThan(1);
          expect(peak).toBeLessThanOrEqual(4);
        } else expect(peak).toBe(1);
        if (missing) {
          expect(result.exit).toBe(1);
          expect(result.data.issues[0].code).toBe("DOWNLOAD_FAILED");
          expect(result.data.media[0].file).toBeNull();
          expect(await readdir(result.data.directory)).toEqual(["metadata.json"]);
        } else {
          expect(result.data.issues).toEqual([]);
          expect(result.exit).toBe(0);
          const asset = result.data.media[0];
          expect(asset.artifact.duration).toBeCloseTo(8, 0);
          expect(asset.artifact.hasAudio).toBe(true);
          await ffmpeg(["-xerror", "-i", asset.file, "-f", "null", "-"]);
        }
      } finally {
        server.stop(true);
      }
    },
    30_000,
  );

  test("converts a local video without changing its bytes, then verifies the saved MP3 and manifest", async () => {
    const f = await fixture();
    const input = await generated(f.root);
    const original = await readFile(input.video);
    const result = await f.run(["src/bin.ts", "audio", input.video, "--output", f.output, "--json"]);
    expect(result.exit).toBe(0);
    expect(result.data.issues).toEqual([]);
    const asset = result.data.media[0];
    expect(asset.kind).toBe("audio");
    expect(asset.url).toBeNull();
    expect(asset.sourceMedia).toMatchObject({ kind: "video", width: 64, height: 64, duration: 2 });
    expect(asset.artifact).toMatchObject({
      contentType: "audio/mpeg",
      hasAudio: true,
      verification: "decode",
      width: null,
      height: null,
    });
    const bytes = await readFile(asset.file);
    expect(asset.artifact.bytes).toBe(bytes.length);
    expect(asset.artifact.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(asset.artifact.inputSha256).toBe(createHash("sha256").update(original).digest("hex"));
    expect(await readFile(input.video)).toEqual(original);
    expect((await readdir(result.data.directory)).sort()).toEqual(["001-source.mp3", "metadata.json"]);
    expect(JSON.parse(await readFile(join(result.data.directory, "metadata.json"), "utf8"))).toEqual(result.data);
    await ffmpeg(["-xerror", "-i", asset.file, "-f", "null", "-"]);
    const reused = await f.run(["src/bin.ts", "audio", asset.file, "--output", f.output, "--json"]);
    expect(reused.exit).toBe(0);
    expect(await readFile(reused.data.media[0].file)).toEqual(bytes);
    expect(reused.data.media[0].artifact.inputSha256).toBe(asset.artifact.sha256);
  }, 65_000);

  test.each([
    ["MP4", "mp4", true, 0],
    ["MKV with duration tags", "mkv", true, 0],
    ["WebM with duration tags", "webm", true, 0],
    ["MKV without duration tags", "mkv", false, 0],
    ["WebM without duration tags", "webm", false, 0],
    ["MKV with delayed audio", "mkv", true, 1],
    ["WebM with delayed audio", "webm", true, 1],
  ] as const)(
    "preserves shorter audio tracks in %s",
    async (_label, container, tagged, offset) => {
      const f = await fixture();
      const input = await generated(f.root);
      const video = join(f.root, `longer-video.${container}`);
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=size=64x64:rate=10:duration=3",
        "-itsoffset",
        String(offset),
        "-i",
        input.audio,
        "-c:v",
        container === "webm" ? "libvpx-vp9" : "libx264",
        "-c:a",
        container === "webm" ? "libopus" : "copy",
        video,
      ]);
      if (!tagged) {
        // Omit duration metadata without changing stream bytes or container offsets.
        const bytes = await readFile(video);
        for (let offset = bytes.indexOf("DURATION"); offset !== -1; offset = bytes.indexOf("DURATION", offset + 8))
          bytes.write("ELAPSED_", offset);
        await writeFile(video, bytes);
      }
      const result = await f.run(["src/bin.ts", "audio", video, "--output", f.output, "--json"]);
      expect(result.exit).toBe(0);
      expect(result.data.issues).toEqual([]);
      expect(result.data.media[0].sourceMedia.duration).toBeCloseTo(3, 0);
      expect(result.data.media[0].artifact.duration).toBeCloseTo(2, 0);
      expect(result.data.media[0].artifact.verification).toBe("decode");
    },
    20_000,
  );

  test.each([
    ["mkvmerge net duration", true],
    ["FFmpeg copied statistics", false],
  ] as const)(
    "preserves delayed audio with %s",
    async (_label, netDuration) => {
      const f = await fixture();
      const video = join(f.root, "track-statistics.mkv");
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=size=64x64:rate=10:duration=4",
        "-itsoffset",
        "1",
        "-f",
        "lavfi",
        "-i",
        "sine=duration=2",
        "-c:v",
        "libx264",
        "-c:a",
        "pcm_s16le",
        "-metadata:s:a:0",
        "_STATISTICS_TAGS=BPS DURATION NUMBER_OF_FRAMES NUMBER_OF_BYTES",
        video,
      ]);
      if (netDuration) {
        // Represent mkvmerge's writer and net duration without changing media or EBML sizes.
        const bytes = await readFile(video);
        const offset = bytes.indexOf("00:00:03.000000000");
        expect(offset).toBeGreaterThan(-1);
        bytes.write("00:00:02.000000000", offset);
        const writers = [...bytes.toString("latin1").matchAll(/Lavf[\d.]+/g)];
        expect(writers.length).toBeGreaterThan(0);
        for (const writer of writers) bytes.write("mkvmerge".padEnd(writer[0].length), writer.index);
        await writeFile(video, bytes);
      }
      const result = await f.run(["src/bin.ts", "audio", video, "--output", f.output, "--json"]);
      expect(result.exit).toBe(0);
      expect(result.data.issues).toEqual([]);
      expect(result.data.media[0].sourceMedia.duration).toBe(4);
      expect(result.data.media[0].artifact.duration).toBeCloseTo(2, 0);
      expect(result.data.media[0].artifact.verification).toBe("decode");
    },
    20_000,
  );

  test("verified container types distinguish Matroska and WebM independently of the filename", async () => {
    const f = await fixture();
    const input = await generated(f.root);
    const matroska = join(f.root, "movie.mkv"),
      webm = join(f.root, "audio.webm");
    await ffmpeg(["-i", input.video, "-c", "copy", matroska]);
    await ffmpeg(["-i", input.audio, "-c:a", "libopus", webm]);
    for (const [file, kind, mime] of [
      [matroska, "video", "video/x-matroska"],
      [webm, "audio", "audio/webm"],
    ]) {
      const result = await f.run([
        "-e",
        `import {verifyMediaFile} from './src/extractors/media/files.ts';console.log(JSON.stringify(await verifyMediaFile(${JSON.stringify(file)},${JSON.stringify(kind)},'fixture',{},AbortSignal.timeout(5000),true)));`,
      ]);
      expect(result.data.contentType).toBe(mime);
      expect(result.data.verification).toBe("probe");
    }
  }, 20000);

  test("--audio selects the available audio stream, skips photos, and preserves the source item index", async () => {
    const f = await fixture();
    const input = await generated(f.root);
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        requests.push(path);
        return new Response(Bun.file(path === "/audio.m4a" ? input.audio : input.video));
      },
    });
    try {
      const info = videoInfo("two", new URL("/video.mp4", server.url).href);
      info.formats.unshift({
        format_id: "audio",
        url: new URL("/audio.m4a", server.url).href,
        ext: "m4a",
        protocol: "http",
        vcodec: "none",
        acodec: "aac",
        width: 0,
        height: 0,
      });
      await writeFile(
        f.metadataPath,
        JSON.stringify({
          id: "post",
          title: "Mixed",
          entries: [{ id: "photo", thumbnails: [{ url: "https://cdn.example/photo.jpg" }] }, info],
        }),
      );
      const result = await f.run(["src/bin.ts", "download", source, "--audio", "--output", f.output, "--json"]);
      expect(result.exit).toBe(0);
      expect(result.data.media).toHaveLength(1);
      expect(result.data.media[0].index).toBe(2);
      expect(result.data.media[0].file).toEndWith("002-two.mp3");
      expect(result.data.media[0].artifact.verification).toBe("decode");
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((path) => path === "/audio.m4a")).toBe(true);
    } finally {
      server.stop(true);
    }
  }, 65_000);

  test("keeps a valid MP3 when another video is silent, removing failed staging files", async () => {
    const f = await fixture();
    const input = await generated(f.root);
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response(Bun.file(new URL(req.url).pathname === "/silent" ? input.silent : input.video));
      },
    });
    try {
      await writeFile(
        f.metadataPath,
        JSON.stringify({
          id: "post",
          entries: [videoInfo("sound", server.url.href), videoInfo("silent", new URL("/silent", server.url).href)],
        }),
      );
      const result = await f.run(["src/bin.ts", "download", source, "--audio", "--output", f.output, "--json"]);
      expect(result.exit).toBe(1);
      expect(result.data.media[0].file).toBeString();
      expect(result.data.media[1].file).toBeNull();
      expect(result.data.issues[0].message).toContain("no audio track");
      expect((await readdir(result.data.directory)).sort()).toEqual(["001-sound.mp3", "metadata.json"]);
    } finally {
      server.stop(true);
    }
  }, 65_000);

  test("rejects corrupt input and enforces actual bytes and duration", async () => {
    const f = await fixture();
    const input = await generated(f.root);
    const bad = join(f.root, "bad.mp4");
    await writeFile(bad, "not media");
    const playlist = join(f.root, "indirect.m3u8");
    await writeFile(playlist, `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n${input.video}\n#EXT-X-ENDLIST\n`);
    for (const [file, options, code] of [
      [bad, {}, "VERIFICATION_FAILED"],
      [playlist, {}, "VERIFICATION_FAILED"],
      [input.video, { maxBytes: 10 }, "LIMIT_EXCEEDED"],
      [input.video, { maxDuration: 1 }, "LIMIT_EXCEEDED"],
    ] as const) {
      const result = await f.run([
        "-e",
        `import {convertAudio} from './src/index.ts';console.log(JSON.stringify((await convertAudio(${JSON.stringify(file)},{directory:${JSON.stringify(f.output)},...${JSON.stringify(options)}})).json));`,
      ]);
      expect(result.data.media[0].file).toBeNull();
      expect(result.data.issues[0].code).toBe(code);
      expect(await readdir(result.data.directory)).toEqual(["metadata.json"]);
    }
  }, 65_000);

  test("a pre-cancelled API call creates no output folder", async () => {
    const f = await fixture();
    const input = await generated(f.root);
    const result = await f.run([
      "-e",
      `import {convertAudio} from './src/index.ts';try { await convertAudio(${JSON.stringify(input.video)}, {directory:${JSON.stringify(f.output)},signal:AbortSignal.abort()}); } catch(error) {console.log(JSON.stringify(error.issue));}`,
    ]);
    expect(result.data.code).toBe("DOWNLOAD_CANCELLED");
    expect(await readdir(f.root)).not.toContain("output");
  }, 65_000);

  test("execution timeout stops native work and reports a structured issue", async () => {
    const f = await fixture({ id: "post", entries: [videoInfo("video", "https://cdn.example/video.mp4")] }, "download");
    const result = await f.run([
      "-e",
      `import {download} from './src/index.ts'; const r=await download(${JSON.stringify(source)},{directory:${JSON.stringify(f.output)},format:"mp3",timeoutMs:1000});console.log(JSON.stringify(r.json));`,
    ]);
    expect(result.data.issues[0].code).toBe("DOWNLOAD_TIMEOUT");
    expect(result.data.media[0].file).toBeNull();
    expect(await readdir(result.data.directory)).toEqual(["metadata.json"]);
  }, 10000);

  test("Ctrl-C cancels active native work and its child processes while preserving a usable manifest", async () => {
    const f = await fixture({ id: "post", entries: [videoInfo("video", "https://cdn.example/video.mp4")] }, "download");
    const proc = f.spawn(["src/bin.ts", "download", source, "--audio", "--output", f.output, "--json"]);
    for (let i = 0; i < 100 && !(await Bun.file(f.env.OUTFORM_TEST_READY).exists()); i++) await Bun.sleep(20);
    expect(await Bun.file(f.env.OUTFORM_TEST_READY).exists()).toBe(true);
    proc.kill("SIGINT");
    const result = await f.collect(proc);
    expect(result.exit).toBe(130);
    expect(result.data.issues[0].code).toBe("DOWNLOAD_CANCELLED");
    expect(await readdir(result.data.directory)).toEqual(["metadata.json"]);
    await Bun.sleep(2200);
    expect(await Bun.file(f.env.OUTFORM_TEST_ORPHAN).exists()).toBe(false);
  }, 10000);
});
