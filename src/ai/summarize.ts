import type { Provider } from "./provider";
import { logError } from "../utils/log";
import { spin } from "../utils/spinner";

const SUMMARIZE_PROMPT =
  "Summarize the following text concisely. Capture the key points, main arguments, and conclusions. Output only the summary, no preamble.\n\n";

const MAX_CONTENT_LENGTH = 100_000;

export async function summarize(
  content: string,
  provider: Provider
): Promise<string | null> {
  if (provider.type === "none") return null;

  const truncated =
    content.length > MAX_CONTENT_LENGTH
      ? content.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated for summarization]"
      : content;

  const s = spin(`Summarizing with ${provider.name}...`);

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
    logError(`AI summarization failed: ${e.message}`);
    return null;
  }
}

async function invokeClaude(content: string): Promise<string> {
  const proc = Bun.spawn(["claude", "-p", SUMMARIZE_PROMPT.trim()], {
    stdin: new Response(content),
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`claude CLI failed: ${stderr.trim() || "unknown error"}`);
  }

  return output.trim();
}

async function invokeCodex(content: string): Promise<string> {
  const proc = Bun.spawn(["codex", "-q", SUMMARIZE_PROMPT.trim()], {
    stdin: new Response(content),
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`codex CLI failed: ${stderr.trim() || "unknown error"}`);
  }

  return output.trim();
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
