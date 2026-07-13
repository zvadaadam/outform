import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Provider } from "./provider";
import { logError, type ExtractLogger } from "../utils/log";
import { spin } from "../utils/spinner";
import { spawn, waitForResult } from "../utils/process";

const SUMMARIZE_PROMPT =
  "Summarize the following text concisely. Capture the key points, main arguments, and conclusions. Output only the summary, no preamble.\n\n";

const MAX_CONTENT_LENGTH = 100_000;
const AI_TIMEOUT_MS = 60_000;

async function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  proc?: { kill(): void },
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      proc?.kill();
      reject(new Error(`${label} timed out after 60s`));
    }, AI_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function summarize(
  content: string,
  provider: Provider,
  logger?: ExtractLogger,
): Promise<string | null> {
  if (provider.type === "none") return null;

  const truncated =
    content.length > MAX_CONTENT_LENGTH
      ? content.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated for summarization]"
      : content;

  const s = spin(`Summarizing with ${provider.name}...`, logger);

  try {
    let result: string;
    switch (provider.type) {
      case "claude-cli":
        result = await invokeClaude(truncated);
        break;
      case "codex-cli":
        result = await invokeCodex(truncated);
        break;
      case "anthropic-api":
        result = await invokeAnthropicApi(truncated);
        break;
      case "openai-api":
        result = await invokeOpenAiApi(truncated);
        break;
    }
    s.stop("Summary generated");
    return result;
  } catch (e: any) {
    s.stop("Summarization failed");
    logError(`AI summarization failed: ${e.message}`, logger);
    return null;
  }
}

async function invokeClaude(content: string): Promise<string> {
  const proc = spawn([
    "claude",
    "--print",
    "--safe-mode",
    "--tools",
    "",
    "--no-session-persistence",
    "--no-chrome",
    "--disable-slash-commands",
    SUMMARIZE_PROMPT.trim(),
  ], {
    stdin: content,
    stdout: "pipe",
    stderr: "pipe",
  });

  const { exitCode, stdout, stderr } = await withTimeout(
    waitForResult(proc),
    "claude CLI",
    proc,
  );

  if (exitCode !== 0) {
    throw new Error(`claude CLI failed: ${stderr.trim() || "unknown error"}`);
  }

  return stdout.trim();
}

async function invokeCodex(content: string): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "outform-codex-"));
  const tmpOutput = join(workDir, "summary.txt");
  const fullPrompt = SUMMARIZE_PROMPT.trim() + "\n\n" + content;

  try {
    const proc = spawn(
      [
        "codex",
        "exec",
        "-",
        "--sandbox",
        "read-only",
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--ignore-rules",
        "-C",
        workDir,
        "-o",
        tmpOutput,
      ],
      {
        stdin: fullPrompt,
        stdout: "pipe",
        stderr: "pipe",
        cwd: workDir,
      },
    );

    const { exitCode, stderr } = await withTimeout(
      waitForResult(proc),
      "codex CLI",
      proc,
    );

    if (exitCode !== 0) {
      throw new Error(`codex CLI failed: ${stderr.trim() || "unknown error"}`);
    }

    const output = await readFile(tmpOutput, "utf-8");
    return output.trim();
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function invokeAnthropicApi(content: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2024-10-22",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: SUMMARIZE_PROMPT + content,
        },
      ],
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as any;
  const text = data.content?.[0]?.text;
  if (!text) throw new Error("No text in Anthropic API response");
  return text.trim();
}

async function invokeOpenAiApi(content: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: SUMMARIZE_PROMPT + content,
        },
      ],
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as any;
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("No text in OpenAI API response");
  return text.trim();
}
