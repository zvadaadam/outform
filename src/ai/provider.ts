import { hasCommand } from "../utils/deps";

export type ProviderType =
  | "claude-cli"
  | "codex-cli"
  | "anthropic-api"
  | "openai-api"
  | "none";

export interface Provider {
  type: ProviderType;
  name: string;
}

export async function detectProvider(
  forced?: string,
  raw?: boolean
): Promise<Provider> {
  if (raw || forced === "none") {
    return { type: "none", name: "none" };
  }

  if (forced === "claude") {
    if (!(await hasCommand("claude"))) {
      throw new Error(
        "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
      );
    }
    return { type: "claude-cli", name: "Claude CLI" };
  }

  if (forced === "codex") {
    if (!(await hasCommand("codex"))) {
      throw new Error(
        "Codex CLI not found. Install with: npm install -g @openai/codex"
      );
    }
    return { type: "codex-cli", name: "Codex CLI" };
  }

  if (forced) {
    throw new Error(
      `Unknown provider "${forced}". Use: claude, codex, or none.`
    );
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return { type: "anthropic-api", name: "Anthropic API" };
  }

  if (process.env.OPENAI_API_KEY) {
    return { type: "openai-api", name: "OpenAI API" };
  }

  if (await hasCommand("claude")) {
    return { type: "claude-cli", name: "Claude CLI" };
  }

  if (await hasCommand("codex")) {
    return { type: "codex-cli", name: "Codex CLI" };
  }

  return { type: "none", name: "none" };
}
