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

async function fixture(metadata: unknown = {}, stall = false) {
  const f = await createManagedTools(["yt-dlp", "ffmpeg", "ffprobe"], {
    ffmpeg: `#!/bin/sh\nexec ${quote(real.ffmpeg)} "$@"\n`,
    ffprobe: `#!/bin/sh\nexec ${quote(real.ffprobe)} "$@"\n`,
    "yt-dlp": `#!/bin/sh
for arg in "$@"; do
 if [ "$arg" = '--dump-single-json' ]; then /bin/cat "$OUTFORM_TEST_METADATA"; exit 0; fi
done
${
  stall
    ? `printf ready > "$OUTFORM_TEST_READY"
(sleep 2; printf orphan > "$OUTFORM_TEST_ORPHAN") &
sleep 30`
    : `exec ${quote(real["yt-dlp"])} "$@"`
}
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
    "-shortest",
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

describe.skipIf(!available)("native audio downloads and local conversion", () => {
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

  test("preserves the complete audio when its track is shorter than the video", async () => {
    const f = await fixture();
    const input = await generated(f.root);
    const video = join(f.root, "longer-video.mp4");
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=size=64x64:rate=10:duration=3",
      "-i",
      input.audio,
      "-c:v",
      "libx264",
      "-c:a",
      "copy",
      video,
    ]);
    const result = await f.run(["src/bin.ts", "audio", video, "--output", f.output, "--json"]);
    expect(result.exit).toBe(0);
    expect(result.data.issues).toEqual([]);
    expect(result.data.media[0].sourceMedia.duration).toBe(3);
    expect(result.data.media[0].artifact.duration).toBeCloseTo(2, 0);
    expect(result.data.media[0].artifact.verification).toBe("decode");
  }, 20_000);

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
        `import {verifyMediaFile} from './src/extractors/media/audio.ts';console.log(JSON.stringify(await verifyMediaFile(${JSON.stringify(file)},${JSON.stringify(kind)},'fixture',{},AbortSignal.timeout(5000),true)));`,
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
    const f = await fixture({ id: "post", entries: [videoInfo("video", "https://cdn.example/video.mp4")] }, true);
    const result = await f.run([
      "-e",
      `import {download} from './src/index.ts'; const r=await download(${JSON.stringify(source)},{directory:${JSON.stringify(f.output)},output:"audio",timeoutMs:1000});console.log(JSON.stringify(r.json));`,
    ]);
    expect(result.data.issues[0].code).toBe("DOWNLOAD_TIMEOUT");
    expect(result.data.media[0].file).toBeNull();
    expect(await readdir(result.data.directory)).toEqual(["metadata.json"]);
  }, 10000);

  test("Ctrl-C cancels active native work and its child processes while preserving a usable manifest", async () => {
    const f = await fixture({ id: "post", entries: [videoInfo("video", "https://cdn.example/video.mp4")] }, true);
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
