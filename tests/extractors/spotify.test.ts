import { afterEach, describe, expect, test } from "bun:test";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseSpotifyPage } from "../../src/extractors/media/spotify";
import { detectUrlType, mediaPlatform } from "../../src/utils/url";
import { createManagedTools } from "../fixtures/tools";

const id = "45m6z2GQIIvert8LxSXcjt";
const source = `https://open.spotify.com/episode/${id}`;
const original = "https://publisher.example/full.mp3";
const preview = "https://p.scdn.co/mp3-preview/sample";
function page(entity = {}, audio = {}) {
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: {
      pageProps: {
        state: {
          data: {
            entity: {
              id,
              type: "episode",
              title: "A long episode",
              subtitle: "The publisher",
              duration: 14400000,
              releaseDate: { isoString: "2026-01-02T12:00:00Z" },
              isPlayable: true,
              audioPreview: { url: preview },
              visualIdentity: {
                image: [
                  { url: "https://cdn.example/small.jpg", maxWidth: 64 },
                  { url: "https://cdn.example/cover.jpg", maxWidth: 640 },
                ],
              },
              ...entity,
            },
            defaultAudioFileObject: { passthrough: "ALLOWED", passthroughUrl: original, ...audio },
          },
        },
      },
    },
  })}</script>`;
}

describe("Spotify public metadata", () => {
  test("preserves publisher, cover, date and a four-hour original, without using its preview", () => {
    const { result, transfers } = parseSpotifyPage(page(), source);
    expect(result.author).toBe("The publisher");
    expect(result.thumbnail).toBe("https://cdn.example/cover.jpg");
    expect(result.uploadDate).toBe("2026-01-02");
    expect(result.media[0]?.duration).toBe(14400);
    expect(result.media[0]?.url).toBe(original);
    expect(transfers.get(1)).toEqual({ type: "http", candidates: [{ url: original }] });
    expect(result.issues).toEqual([]);
  });
  test.each([
    { passthrough: "NONE", url: [{ url: "https://encrypted.example/audio" }] },
    { passthroughUrl: "" },
    { passthroughUrl: preview },
    { passthroughUrl: "https://another.example/mp3-preview/sample" },
    { passthroughUrl: "file:///private/audio.mp3" },
  ])("retains metadata but never downloads previews or protected streams: %j", (audio) => {
    const { result, transfers } = parseSpotifyPage(page({}, audio), source);
    expect(result.title).toBe("A long episode");
    expect(result.media).toEqual([]);
    expect(transfers.size).toBe(0);
    expect(result.issues[0]?.code).toBe("MEDIA_UNAVAILABLE");
  });
  test("reports explicit unavailability and keeps track metadata without promising music downloads", () => {
    expect(parseSpotifyPage(page({ isPlayable: false }), source).result.issues[0]?.code).toBe("MEDIA_RESTRICTED");
    const { result, transfers } = parseSpotifyPage(
      page({ type: "track", subtitle: null, artists: [{ name: "Artist" }] }),
      source.replace("episode", "track"),
    );
    expect(result.author).toBe("Artist");
    expect(result.issues[0]?.message).toContain("music downloads are not supported");
    expect(transfers.size).toBe(0);
  });
  test.each([
    "<html>Access check</html>",
    '<script id="__NEXT_DATA__">{broken}</script>',
    page({ id: "wrong" }),
    page({ type: "show" }),
  ])("rejects missing, malformed or mismatched metadata", (html) => {
    expect(() => parseSpotifyPage(html, source)).toThrow();
  });
  test("routes only individual Spotify items and preserves ordinary YouTube and Reddit behavior", () => {
    for (const prefix of ["", "embed/", "intl-de/"]) {
      expect(detectUrlType(`https://open.spotify.com/${prefix}episode/${id}?si=share`)).toBe("media");
    }
    expect(mediaPlatform(source.replace("open.spotify.com", "open.spotify.com.evil.example"))).toBeNull();
    expect(detectUrlType(source.replace("episode", "show"))).toBe("web");
    expect(detectUrlType("https://youtu.be/abc123def45")).toBe("youtube");
    expect(detectUrlType("https://reddit.com/r/example/comments/abc/post")).toBe("web");
  });
});

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(html = page(), failure = "") {
  const tools = await createManagedTools([]);
  roots.push(tools.root);
  const preload = join(tools.root, "public-responses.ts");
  const calls = join(tools.root, "calls.jsonl");
  await writeFile(
    preload,
    `import { mock } from "bun:test";
    import { appendFileSync } from "node:fs";
    mock.module(${JSON.stringify(resolve("src/utils/public-fetch.ts"))}, () => ({ publicFetch: async (input) => {
      const url = String(input); appendFileSync(${JSON.stringify(calls)}, JSON.stringify(url) + "\\n");
      const failure = ${JSON.stringify(failure)};
      if (url.includes("/embed/")) return new Response(${JSON.stringify(html)});
      if (url === ${JSON.stringify(source)}) return failure === "description" ? new Response("Unavailable", {status:403}) : new Response('<meta name="description" content="Full description &amp; publisher notes.">');
      if (failure === "429") return new Response("Wait", {status:429});
      if (failure === "html") return new Response("<html>Access denied</html>", {headers:{"content-type":"text/html"}});
      return new Response(new Uint8Array([73,68,51,4,0,0]), {headers:{"content-type":"audio/mpeg", "content-length":failure === "incomplete" ? "30" : "6"}});
    }}));`,
  );
  async function run(args: string[]) {
    const proc = Bun.spawn([process.execPath, "--preload", preload, ...args], {
      env: { ...process.env, ...tools.env, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { data: JSON.parse(stdout), stderr, exit };
  }
  return { root: tools.root, output: join(tools.root, "downloads"), calls, run };
}

describe("Spotify CLI and API without media tools", () => {
  test("extracts full description, inspects ready, then downloads exact original bytes and manifest", async () => {
    const f = await fixture();
    const inspected = await f.run([
      "-e",
      `import { inspect } from './src/index.ts'; console.log(JSON.stringify(await inspect(${JSON.stringify(source)})))`,
    ]);
    expect(inspected.data.ready).toBe(true);
    const extracted = await f.run(["src/bin.ts", source, "--json"]);
    expect(extracted.exit).toBe(0);
    expect(extracted.data.description).toBe("Full description & publisher notes.");
    expect(extracted.data.media[0].file).toBeNull();
    expect(await readFile(f.calls, "utf8")).not.toContain(original);
    const downloaded = await f.run(["src/bin.ts", "download", source, "--output", f.output, "--json"]);
    expect(downloaded.exit).toBe(0);
    expect(await readFile(downloaded.data.media[0].file)).toEqual(Buffer.from([73, 68, 51, 4, 0, 0]));
    expect(JSON.parse(await readFile(join(downloaded.data.directory, "metadata.json"), "utf8"))).toEqual(
      downloaded.data,
    );
    expect(await readFile(f.calls, "utf8")).not.toContain(preview);
  });
  test("metadata-only episodes report why and fail download before creating folders", async () => {
    const f = await fixture(page({}, { passthrough: "NONE" }));
    const extracted = await f.run(["src/bin.ts", source, "--json"]);
    expect(extracted.data.title).toBe("A long episode");
    expect(extracted.data.media).toEqual([]);
    const downloaded = await f.run(["src/bin.ts", "download", source, "--output", f.output, "--json"]);
    expect(downloaded.exit).toBe(1);
    expect(downloaded.data.issues[0].code).toBe("MEDIA_UNAVAILABLE");
    expect(await readdir(f.root)).not.toContain("downloads");
    expect(await readFile(f.calls, "utf8")).not.toContain(preview);
  });
  test.each([
    ["html", "DOWNLOAD_FAILED"],
    ["incomplete", "DOWNLOAD_FAILED"],
    ["429", "RATE_LIMITED"],
  ])("rejects %s audio responses without leaving partial files", async (failure, code) => {
    const f = await fixture(page(), failure);
    const downloaded = await f.run(["src/bin.ts", "download", source, "--output", f.output, "--json"]);
    expect(downloaded.exit).toBe(1);
    expect(downloaded.data.issues[0].code).toBe(code);
    expect(downloaded.data.media[0].file).toBeNull();
    expect(await readdir(downloaded.data.directory)).toEqual(["metadata.json"]);
  });
  test("description failure keeps downloadable audio and reports the missing metadata", async () => {
    const f = await fixture(page(), "description");
    const downloaded = await f.run(["src/bin.ts", "download", source, "--output", f.output, "--json"]);
    expect(downloaded.data.media[0].file).toBeString();
    expect(downloaded.data.issues[0].message).toContain("description unavailable");
    expect(downloaded.exit).toBe(1);
  });
});
