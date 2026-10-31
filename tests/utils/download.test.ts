import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadFile } from "../../src/utils/download";

describe("verified downloads", () => {
  test("publishes matching bytes and preserves the previous file on a bad checksum", async () => {
    const data = "tool binary fixture";
    const server = Bun.serve({ port: 0, fetch: () => new Response(data) });
    const dir = await mkdtemp(join(tmpdir(), "outform-download-"));
    const destination = join(dir, "tool");
    try {
      await writeFile(destination, "previous version");
      await expect(
        downloadFile(server.url.toString(), destination, { label: "fixture", sha256: "0".repeat(64) }),
      ).rejects.toThrow("Checksum mismatch");
      expect(await readFile(destination, "utf8")).toBe("previous version");
      expect(await readdir(dir)).toEqual(["tool"]);
      await downloadFile(server.url.toString(), destination, {
        label: "fixture",
        executable: true,
        sha256: createHash("sha256").update(data).digest("hex"),
      });
      expect(await readFile(destination, "utf8")).toBe(data);
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
