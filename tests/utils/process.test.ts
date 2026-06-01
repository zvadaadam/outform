import { describe, expect, test } from "bun:test";
import { spawn, waitForResult } from "../../src/utils/process";

describe("waitForResult", () => {
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
