import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, waitForResult } from "../../src/utils/process";

describe("waitForResult", () => {
  test("handles early stdin closure under Node without losing provider errors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outform-process-"));
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "../../src/utils/process.ts")],
        outdir: directory,
        target: "node",
        format: "esm",
      });
      expect(build.success).toBe(true);
      const moduleUrl = pathToFileURL(build.outputs[0]!.path).href;
      const script = `
        import { spawn, waitForResult } from ${JSON.stringify(moduleUrl)};
        const results = [];
        for (const code of [7, 0]) {
          results.push(await waitForResult(spawn([
            process.execPath, '-e',
            "process.stderr.write('authentication required'); process.exit(" + code + ")"
          ], { stdin: 'prompt'.repeat(2 * 1024 * 1024) })));
        }
        process.stdout.write(JSON.stringify(results));
      `;
      const result = await waitForResult(spawn(["node", "--input-type=module", "-e", script]));
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual([
        { exitCode: 7, stdout: "", stderr: "authentication required" },
        { exitCode: 1, stdout: "", stderr: "authentication required" },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("drains stderr while waiting for the child to exit", async () => {
    const payload = [
      "let i = 0;",
      "const chunks = 128;",
      "const buf = 'x'.repeat(256 * 1024);",
      "function write() {",
      "  while (i < chunks) {",
      "    i += 1;",
      "    if (!process.stderr.write(buf)) {",
      "      return process.stderr.once('drain', write);",
      "    }",
      "  }",
      "  process.stdout.write('done');",
      "  process.exit(0);",
      "}",
      "write();",
    ].join("");

    const proc = spawn([process.execPath, "-e", payload], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(new Error("waitForResult timed out"));
      }, 2_000);
    });

    const result = await Promise.race([waitForResult(proc), timeout]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("done");
    expect(result.stderr.length).toBeGreaterThan(1024 * 1024);
  });
});
