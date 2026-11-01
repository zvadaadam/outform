import { afterEach, describe, expect, test } from "bun:test";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createManagedTools } from "../fixtures/tools";

const roots: string[] = [];
const source = "https://www.instagram.com/p/test/";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
  "base64",
);
const downloader = `#!/bin/sh
printf '%s\\n' "$*" >> "$OUTFORM_TEST_CALLS"
if [ -n "$OUTFORM_TEST_FAILURE" ]; then
  printf '%s\\n' "ERROR: $OUTFORM_TEST_FAILURE" >&2
  exit 1
fi
/bin/cat "$OUTFORM_TEST_METADATA"
`;

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(entries: unknown[]) {
  const tools = await createManagedTools(["yt-dlp"], { "yt-dlp": downloader });
  roots.push(tools.root);
  const metadata = join(tools.root, "source.json");
  await writeFile(
    metadata,
    JSON.stringify({
      id: "../../post",
      title: "A carousel",
      description: "The full caption.",
      uploader: "Creator",
      entries,
    }),
  );
  const calls = join(tools.root, "calls");
  const env = {
    ...process.env,
    ...tools.env,
    NO_COLOR: "1",
    OUTFORM_TEST_METADATA: metadata,
    OUTFORM_TEST_CALLS: calls,
  };
  const run = async (args: string[], overrides = {}) => {
    const proc = Bun.spawn([process.execPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...env, ...overrides },
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exit, data: JSON.parse(stdout) };
  };
  return { tools, calls, run, output: join(tools.root, "downloads") };
}

function photo(id: string, url: string) {
  return { id, thumbnails: [{ url }] };
}

describe("social CLI and API downloads", () => {
  test("saves original image bytes, ordered filenames and manifest; repeat runs preserve old files", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response(png, { headers: { "Content-Type": "image/png" } }) });
    try {
      const f = await fixture([photo("../one", server.url.href), photo("two", server.url.href)]);
      const args = ["src/bin.ts", "download", source, "--output", f.output, "--json"];
      const first = await f.run(args);
      expect(first.exit).toBe(0);
      expect(first.stderr).toContain("Downloading image 1/2");
      expect(first.data.type).toBe("media");
      expect(first.data.author).toBe("Creator");
      expect(first.data.media.map((m: { index: number }) => m.index)).toEqual([1, 2]);
      const file = first.data.media[0].file;
      expect(file.startsWith(resolve(f.output) + "/")).toBe(true);
      expect(await readFile(file)).toEqual(png);
      expect(JSON.parse(await readFile(join(first.data.directory, "metadata.json"), "utf8"))).toEqual(first.data);
      expect(await readdir(first.data.directory)).toHaveLength(3);
      const second = await f.run(args);
      expect(second.data.directory).not.toBe(first.data.directory);
      expect(await readFile(file)).toEqual(png);
      const calls = await readFile(f.calls, "utf8");
      expect(calls).toContain("--ignore-config");
      expect(calls).not.toMatch(/--cookies|--username|--password/);
    } finally {
      server.stop(true);
    }
  });

  test("keeps successful files and returns exit 1 with a useful issue for an HTML download", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === "/ok"
          ? new Response(png, { headers: { "Content-Type": "image/png" } })
          : new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } }),
    });
    try {
      const f = await fixture([
        photo("one", new URL("/ok", server.url).href),
        photo("two", new URL("/bad", server.url).href),
      ]);
      const result = await f.run(["src/bin.ts", "download", source, "--output", f.output, "--json"]);
      expect(result.exit).toBe(1);
      expect(result.data.media[0].file).toBeString();
      expect(result.data.media[1].file).toBeNull();
      expect(result.data.issues[0].code).toBe("DOWNLOAD_FAILED");
      expect(result.data.issues[0].message).toContain("text/html");
      expect(await readdir(result.data.directory)).toHaveLength(2);
    } finally {
      server.stop(true);
    }
  });

  test("extract() reads metadata without downloading and download() remains quiet by default", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response(png, { headers: { "Content-Type": "image/png" } }) });
    try {
      const f = await fixture([photo("one", server.url.href)]);
      const extracted = await f.run([
        "-e",
        `import { extract } from './src/index.ts'; console.log(JSON.stringify((await extract(${JSON.stringify(source)})).json))`,
      ]);
      expect(extracted.stderr).toBe("");
      expect(extracted.data.directory).toBeNull();
      expect(extracted.data.media[0].file).toBeNull();
      const saved = await f.run([
        "-e",
        `import { download, render } from './src/index.ts'; console.log(render(await download(${JSON.stringify(source)}, {directory: ${JSON.stringify(f.output)}}), 'json'))`,
      ]);
      expect(saved.stderr).toBe("");
      expect(saved.data.media[0].file).toBeString();
    } finally {
      server.stop(true);
    }
  });

  test("falls back to another source image when the original URL has expired", async () => {
    const requested: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        requested.push(path);
        return path === "/original"
          ? new Response("Expired", { status: 403 })
          : new Response(png, { headers: { "Content-Type": "image/png" } });
      },
    });
    try {
      const original = new URL("/original", server.url).href;
      const alternate = new URL("/available", server.url).href;
      const f = await fixture([
        {
          id: "photo",
          thumbnail: original,
          thumbnails: [
            { url: original, width: 200, height: 200 },
            { url: alternate, width: 1, height: 1 },
          ],
        },
      ]);
      const result = await f.run(["src/bin.ts", "download", source, "--output", f.output, "--json"]);
      expect(result.exit).toBe(0);
      expect(requested).toEqual(["/original", "/available"]);
      expect(result.data.media[0].url).toBe(alternate);
      expect(result.data.media[0].width).toBe(1);
      expect(await readFile(result.data.media[0].file)).toEqual(png);
    } finally {
      server.stop(true);
    }
  });

  test("reports anonymous-access failure without prompting for cookies", async () => {
    const f = await fixture([]);
    const result = await f.run(["src/bin.ts", "download", source, "--json"], {
      OUTFORM_TEST_FAILURE: "Login required",
    });
    expect(result.exit).toBe(1);
    expect(result.data.issues[0].code).toBe("LOGIN_REQUIRED");
    expect(result.data.issues[0].message).toContain("does not connect accounts");
    expect(result.stdout).not.toContain("--cookies-from-browser");
  });

  test.each([
    ["This post is private. Use --cookies for authentication", "MEDIA_RESTRICTED", "private or limited"],
    ["HTTP Error 429: Too Many Requests. Login required", "RATE_LIMITED", "Wait a few minutes"],
    ["This video has been removed", "MEDIA_NOT_FOUND", "missing or removed"],
    ["This format is DRM protected", "MEDIA_PROTECTED", "copy-protected"],
    ["Not available in your country", "MEDIA_RESTRICTED", "age or location"],
    ["HTTP Error 403: Forbidden", "MEDIA_RESTRICTED", "does not necessarily mean"],
    ["Connection timed out", "MEDIA_UNAVAILABLE", "Check your connection"],
    ["Cannot parse data; please report this issue on yt-dlp", "MEDIA_UNAVAILABLE", "exact reason is unknown"],
  ])("explains %s without raw downloader instructions", async (failure, code, message) => {
    const f = await fixture([]);
    const result = await f.run(["src/bin.ts", "download", source, "--json"], { OUTFORM_TEST_FAILURE: failure });
    expect(result.exit).toBe(1);
    expect(result.data.issues[0].code).toBe(code);
    expect(result.data.issues[0].message).toContain(message);
    expect(result.data.issues[0].message).not.toContain("--cookies");
  });

  test("keeps the rate-limit reason on a failed carousel item", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === "/ok"
          ? new Response(png, { headers: { "Content-Type": "image/png" } })
          : new Response("Too many requests", { status: 429 }),
    });
    try {
      const f = await fixture([
        photo("one", new URL("/ok", server.url).href),
        {
          id: "two",
          thumbnail: new URL("/limited", server.url).href,
          thumbnails: [{ url: new URL("/limited", server.url).href }, { url: new URL("/ok", server.url).href }],
        },
        photo("three", new URL("/ok", server.url).href),
      ]);
      const result = await f.run(["src/bin.ts", "download", source, "--output", f.output, "--json"]);
      expect(result.exit).toBe(1);
      expect(result.data.issues[0].code).toBe("RATE_LIMITED");
      expect(result.data.issues[0].message).toContain("Item 2");
      expect(result.data.issues[0].message).toContain("Remaining items were not attempted");
      expect(result.data.media[2].file).toBeNull();
      expect(result.stderr).toContain("Download incomplete: 1 file(s) saved");
      expect(result.stderr).toContain(result.data.directory);
      expect(result.data.media[0].file).toBeString();
    } finally {
      server.stop(true);
    }
  });

  test("video downloads report missing ffmpeg before creating output", async () => {
    const f = await fixture([
      { id: "video", formats: [{ url: "https://cdn.example/video.mp4", vcodec: "h264", acodec: "aac" }] },
    ]);
    const result = await f.run(["src/bin.ts", "download", source, "--output", f.output, "--json"]);
    expect(result.exit).toBe(1);
    expect(result.data.issues[0].code).toBe("MISSING_DEPENDENCY");
    expect(result.data.issues[0].dependency).toBe("ffmpeg");
    expect(await readdir(f.tools.root)).not.toContain("downloads");
  });

  test("missing managed downloader is a structured dependency error", async () => {
    const f = await fixture([]);
    const result = await f.run(["src/bin.ts", "download", source, "--json"], {
      OUTFORM_TOOLS_DIR: join(f.tools.root, "missing"),
    });
    expect(result.exit).toBe(1);
    expect(result.data.issues[0].code).toBe("MISSING_DEPENDENCY");
    expect(result.data.issues[0].dependency).toBe("yt-dlp");
  });
});
