import { spawn as nodeSpawn } from "node:child_process";
import { access, writeFile, readFile, mkdir, rename, stat, constants } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import assets from "./tool-assets.json";
import { delimiter, dirname, join } from "node:path";
import { homedir } from "node:os";

export function toolsDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.OUTFORM_TOOLS_DIR || join(homedir(), ".local", "share", "outform", "tools");
}

const MANAGED_TOOLS = {
  "yt-dlp": "youtube",
  deno: "deno",
  ffmpeg: "ffmpeg",
  ffprobe: "ffmpeg",
  "whisper-cli": "whisper",
  "whisper-cpp": "whisper",
} as const;

export type ManagedToolTarget = (typeof MANAGED_TOOLS)[keyof typeof MANAGED_TOOLS];

function toolRelease(target: ManagedToolTarget) {
  if (target === "whisper" && process.platform === "linux") return assets.whisper.linux;
  if (target === "whisper" && process.platform === "darwin") return assets.whisper.homebrew;
  if (target === "whisper") {
    const { version, baseUrl, sha256 } = assets.whisper;
    return { version, baseUrl, sha256 };
  }
  return assets[target];
}

export function managedToolTarget(command: string): ManagedToolTarget | undefined {
  const name = command.replace(/\.exe$/i, "");
  return Object.hasOwn(MANAGED_TOOLS, name) ? MANAGED_TOOLS[name as keyof typeof MANAGED_TOOLS] : undefined;
}

export function managedToolDirectory(target: ManagedToolTarget, env: NodeJS.ProcessEnv = process.env): string {
  return join(toolsDirectory(env), target, toolRelease(target).version, `${process.platform}-${process.arch}`);
}

export function toolPath(command: string, env: NodeJS.ProcessEnv = process.env): string {
  const target = managedToolTarget(command);
  const name = command.replace(/\.exe$/i, "") === "whisper-cpp" ? "whisper-cli" : command.replace(/\.exe$/i, "");
  const root = target ? managedToolDirectory(target, env) : toolsDirectory(env);
  return join(root, "bin", name + (process.platform === "win32" ? ".exe" : ""));
}

// Keep child tool discovery aligned with direct executable resolution.
export function toolEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const key = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const directories = (["youtube", "deno", "ffmpeg", "whisper"] as const).map((target) =>
    join(managedToolDirectory(target, env), "bin"),
  );
  return { ...env, [key]: [...directories, env[key] ?? ""].join(delimiter) };
}

const digestCache = new Map<string, { stamp: string; digest: Promise<string> }>();

export async function fileSha256(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`Not a regular file: ${path}`);
  const stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`;
  const cached = digestCache.get(path);
  if (cached?.stamp === stamp) return cached.digest;
  const digest = (async () => {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex");
  })();
  digestCache.set(path, { stamp, digest });
  return digest;
}

function installedFiles(target: ManagedToolTarget): string[] {
  switch (target) {
    case "youtube":
      return ["yt-dlp"];
    case "deno":
      return ["deno"];
    case "ffmpeg":
      return ["ffmpeg", "ffprobe"];
    case "whisper":
      return ["whisper-cli"];
  }
}

function receiptFiles(target: ManagedToolTarget): string[] {
  if (target === "whisper" && process.platform === "linux") {
    return (assets.whisper.linux.files as Record<string, string[]>)[process.arch] ?? ["whisper-cli"];
  }
  const binaries = installedFiles(target).map((command) => command + (process.platform === "win32" ? ".exe" : ""));
  return target === "whisper" && process.platform === "win32"
    ? [...binaries, "whisper.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu.dll"]
    : binaries;
}

interface ToolReceipt {
  release: string;
  version: string;
  platform: string;
  arch: string;
  files: Record<string, string>;
}

function releaseFingerprint(target: ManagedToolTarget): string {
  return createHash("sha256")
    .update(JSON.stringify(toolRelease(target)))
    .digest("hex");
}

// Called only after checksum-verified installation and executable validation.
export async function recordManagedTool(target: ManagedToolTarget): Promise<void> {
  const directory = managedToolDirectory(target);
  const files: Record<string, string> = {};
  for (const name of receiptFiles(target)) files[name] = await fileSha256(join(directory, "bin", name));
  const receipt: ToolReceipt = {
    release: releaseFingerprint(target),
    version: toolRelease(target).version,
    platform: process.platform,
    arch: process.arch,
    files,
  };
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `receipt-${randomUUID()}.json`);
  await writeFile(temporary, JSON.stringify(receipt) + "\n");
  await rename(temporary, join(directory, "receipt.json"));
}

export async function hasManagedTool(command: string): Promise<boolean> {
  const target = managedToolTarget(command);
  if (!target) return false;
  const directory = managedToolDirectory(target);
  try {
    const receipt: ToolReceipt = JSON.parse(await readFile(join(directory, "receipt.json"), "utf8"));
    if (
      receipt.release !== releaseFingerprint(target) ||
      receipt.version !== toolRelease(target).version ||
      receipt.platform !== process.platform ||
      receipt.arch !== process.arch
    )
      return false;
    for (const name of receiptFiles(target)) {
      if (
        typeof receipt.files?.[name] !== "string" ||
        (await fileSha256(join(directory, "bin", name))) !== receipt.files[name]
      )
        return false;
    }
    for (const binary of installedFiles(target)) {
      await access(toolPath(binary), process.platform === "win32" ? constants.F_OK : constants.X_OK);
    }
    if (target === "whisper") await verifyWhisperExecutable();
    return true;
  } catch {
    return false;
  }
}

export async function verifyWhisperExecutable(timeoutMs = 120_000): Promise<void> {
  const proc = spawn(["whisper-cli", "--help"]);
  // Homebrew loads Metal before parsing --help; shader compilation can exceed 15 seconds.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  try {
    const result = await waitForResult(proc);
    if (timedOut) throw new Error(`whisper-cli startup timed out after ${timeoutMs / 1000} seconds.`);
    if (result.exitCode !== 0) throw new Error(`whisper-cli could not run: ${result.stderr.trim()}`);
    const output = result.stdout + "\n" + result.stderr;
    if (!["usage:", "--model", "--file", "--output-json", "--output-file"].every((flag) => output.includes(flag))) {
      throw new Error("whisper-cli does not support the required model, audio, and JSON output options");
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface Proc {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  exited: Promise<number>;
  kill(): void;
}

export interface ProcResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const processGroups = new Set<number>();
const terminationSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

function killProcessGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {
    // The process group may already have exited.
  }
}

function killProcessGroups() {
  for (const pid of processGroups) killProcessGroup(pid, "SIGKILL");
}

function defaultTermination(signal: NodeJS.Signals) {
  // CLI/API handlers own graceful cancellation. Preserve default termination otherwise.
  if (process.listeners(signal).some((listener) => listener !== defaultTermination)) return;
  killProcessGroups();
  process.removeListener(signal, defaultTermination);
  process.kill(process.pid, signal);
}

function trackProcessGroup(pid: number) {
  if (!processGroups.size) {
    process.on("exit", killProcessGroups);
    // Run before once-handlers remove themselves, so they remain visible above.
    for (const signal of terminationSignals) process.prependListener(signal, defaultTermination);
  }
  processGroups.add(pid);
  return () => {
    processGroups.delete(pid);
    if (!processGroups.size) {
      process.removeListener("exit", killProcessGroups);
      for (const signal of terminationSignals) process.removeListener(signal, defaultTermination);
    }
  };
}

export function spawn(
  cmd: string[],
  opts?: {
    stdout?: "pipe" | "inherit" | "stderr";
    stderr?: "pipe" | "inherit";
    stdin?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  },
): Proc {
  opts?.signal?.throwIfAborted();
  const executable = managedToolTarget(cmd[0]!) ? toolPath(cmd[0]!, opts?.env) : cmd[0]!;
  const detached = !!opts?.signal && process.platform !== "win32";
  const child = nodeSpawn(executable, cmd.slice(1), {
    stdio: [
      opts?.stdin !== undefined ? "pipe" : "ignore",
      opts?.stdout === "stderr" ? 2 : (opts?.stdout ?? "pipe"),
      opts?.stderr ?? "pipe",
    ],
    cwd: opts?.cwd,
    detached,
    env: toolEnvironment(opts?.env),
  });

  const untrack = detached && child.pid ? trackProcessGroup(child.pid) : undefined;
  let closed = false;
  let cleanup: Promise<void> | undefined;
  const stop = () => {
    if (!child.pid || closed || cleanup) return;
    if (!opts?.signal) {
      child.kill();
      return;
    }
    if (process.platform === "win32") {
      cleanup = new Promise((resolve) => {
        const killer = nodeSpawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        killer.on("error", () => {
          child.kill();
          resolve();
        });
        killer.on("close", (code) => {
          if (code !== 0) child.kill();
          resolve();
        });
      });
    } else {
      const pid = child.pid;
      killProcessGroup(pid, "SIGTERM");
      cleanup = new Promise((resolve) => {
        // Descendants can outlive the direct child and close all inherited pipes.
        setTimeout(() => {
          killProcessGroup(pid, "SIGKILL");
          resolve();
        }, 1000);
      });
    }
  };
  opts?.signal?.addEventListener("abort", stop, { once: true });
  if (opts?.signal?.aborted) stop();
  child.once("close", () => {
    closed = true;
    opts?.signal?.removeEventListener("abort", stop);
  });

  let stdinFailed = false;
  if (opts?.stdin !== undefined && child.stdin) {
    // A provider can reject the request and exit before it consumes the prompt.
    // Keep its stderr and exit status available instead of emitting an unhandled EPIPE.
    child.stdin.on("error", () => {
      stdinFailed = true;
    });
    child.stdin.end(opts.stdin);
  }

  return {
    stdout: child.stdout,
    stderr: child.stderr,
    exited: new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code === 0 && stdinFailed ? 1 : (code ?? 1)));
      child.on("error", () => resolve(1));
    }).then(async (code) => {
      await cleanup;
      untrack?.();
      return code;
    }),
    kill: stop,
  };
}

export async function collectText(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (!stream) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function waitForResult(proc: Proc): Promise<ProcResult> {
  const stdoutPromise = collectText(proc.stdout);
  const stderrPromise = collectText(proc.stderr);
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, stdoutPromise, stderrPromise]);

  return {
    stdout,
    stderr,
    exitCode,
  };
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeWithDirs(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export { readFile };
