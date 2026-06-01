import { spawn as nodeSpawn } from "node:child_process";
import { access, writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

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

export function spawn(
  cmd: string[],
  opts?: {
    stdout?: "pipe" | "inherit";
    stderr?: "pipe" | "inherit";
    stdin?: string;
  },
): Proc {
  const child = nodeSpawn(cmd[0]!, cmd.slice(1), {
    stdio: [
      opts?.stdin !== undefined ? "pipe" : "ignore",
      opts?.stdout ?? "pipe",
      opts?.stderr ?? "pipe",
    ],
  });

  if (opts?.stdin !== undefined && child.stdin) {
    child.stdin.end(opts.stdin);
  }

  return {
    stdout: child.stdout,
    stderr: child.stderr,
    exited: new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    }),
    kill: () => child.kill(),
  };
}

export async function collectText(
  stream: NodeJS.ReadableStream | null,
): Promise<string> {
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
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    stdoutPromise,
    stderrPromise,
  ]);

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

export async function writeWithDirs(
  path: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export { readFile };
