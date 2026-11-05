import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn as nodeSpawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, waitForResult } from "../../src/utils/process";

async function processModule(directory: string) {
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "../../src/utils/process.ts")],
    outdir: directory,
    target: "node",
    format: "esm",
  });
  expect(build.success).toBe(true);
  return pathToFileURL(build.outputs[0]!.path).href;
}

async function waitForPid(file: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const pid = await readFile(file, "utf8").catch(() => "");
    if (pid) return Number(pid);
    await Bun.sleep(20);
  }
  throw new Error(`Child did not start: ${file}`);
}

function kill(pid: number | undefined, group = false) {
  if (!pid) return;
  try {
    process.kill(group ? -pid : pid, "SIGKILL");
  } catch {
    // The fixture has already stopped.
  }
}

describe("waitForResult", () => {
  test("handles early stdin closure under Node without losing provider errors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outform-process-"));
    try {
      const moduleUrl = await processModule(directory);
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

describe.skipIf(process.platform === "win32")("Node process-tree cancellation", () => {
  test.each(["SIGINT", "SIGTERM", "exit"])(
    "host termination (%s) stops its active tool",
    async (termination) => {
      const directory = await mkdtemp(join(tmpdir(), "outform-terminal-"));
      const pidFile = join(directory, "tool.pid"),
        marker = join(directory, "orphan");
      const moduleUrl = await processModule(directory);
      const tool = `
      const fs = require('node:fs');
      fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      setTimeout(() => fs.writeFileSync(${JSON.stringify(marker)}, 'orphan'), 2000);
      setInterval(() => {}, 1000);
    `;
      const script = `
      import { existsSync } from 'node:fs';
      import { spawn, waitForResult } from ${JSON.stringify(moduleUrl)};
      ${termination === "exit" ? `const ready = setInterval(() => { if (existsSync(${JSON.stringify(pidFile)})) process.exit(7); }, 10);` : ""}
      await waitForResult(spawn([process.execPath, '-e', ${JSON.stringify(tool)}], {signal: new AbortController().signal}));
    `;
      const host = nodeSpawn("node", ["--input-type=module", "-e", script], { detached: true, stdio: "ignore" });
      const exited = new Promise((resolve) => host.once("close", resolve));
      let pid: number | undefined;
      try {
        pid = await waitForPid(pidFile);
        if (termination !== "exit") process.kill(-host.pid!, termination as NodeJS.Signals);
        await exited;
        if (termination === "exit") expect(host.exitCode).toBe(7);
        else expect(host.signalCode).toBe(termination);
        await Bun.sleep(2200);
        expect(await Bun.file(marker).exists()).toBe(false);
      } finally {
        kill(host.pid, true);
        kill(pid);
        await rm(directory, { recursive: true, force: true });
      }
    },
    10_000,
  );

  test.each(["abort", "SIGINT"])(
    "finishes descendant cleanup on %s after the direct child exits",
    async (cancel) => {
      const directory = await mkdtemp(join(tmpdir(), "outform-force-kill-"));
      const pidFile = join(directory, "grandchild.pid"),
        toolPidFile = join(directory, "tool.pid"),
        marker = join(directory, "orphan");
      const moduleUrl = await processModule(directory);
      const grandchild = `
      const fs = require('node:fs');
      process.on('SIGTERM', () => {});
      fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      setTimeout(() => fs.writeFileSync(${JSON.stringify(marker)}, 'orphan'), 2000);
      setInterval(() => {}, 1000);
    `;
      const tool = `
      require('node:fs').writeFileSync(${JSON.stringify(toolPidFile)}, String(process.pid));
      require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], {stdio: 'ignore'});
      setInterval(() => {}, 1000);
    `;
      const script = `
      import { existsSync } from 'node:fs';
      import { spawn, waitForResult } from ${JSON.stringify(moduleUrl)};
      const controller = new AbortController();
      ${cancel === "SIGINT" ? "process.once('SIGINT', () => { controller.abort(); process.exitCode = 130; });" : ""}
      const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit'];
      const before = signals.map(s => process.listenerCount(s));
      const proc = spawn([process.execPath, '-e', ${JSON.stringify(tool)}], {signal: controller.signal});
      const ready = setInterval(() => {
        if (!existsSync(${JSON.stringify(pidFile)})) return;
        clearInterval(ready);
        ${cancel === "SIGINT" ? "process.kill(process.pid, 'SIGINT');" : "controller.abort();"}
      }, 10);
      await waitForResult(proc);
      for (const [i, signal] of signals.entries()) {
        const expected = before[i] - (signal === 'SIGINT' && ${JSON.stringify(cancel)} === 'SIGINT' ? 1 : 0);
        if (process.listenerCount(signal) !== expected) process.exitCode = 99;
      }
    `;
      const host = nodeSpawn("node", ["--input-type=module", "-e", script], { detached: true, stdio: "ignore" });
      const exited = new Promise((resolve) => host.once("close", resolve));
      let pid: number | undefined, toolPid: number | undefined;
      try {
        pid = await waitForPid(pidFile);
        toolPid = await waitForPid(toolPidFile);
        await exited;
        expect(host.exitCode).toBe(cancel === "SIGINT" ? 130 : 0);
        await Bun.sleep(2200);
        expect(await Bun.file(marker).exists()).toBe(false);
      } finally {
        kill(host.pid, true);
        kill(toolPid, true);
        kill(pid);
        await rm(directory, { recursive: true, force: true });
      }
    },
    10_000,
  );
});
