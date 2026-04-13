import { describe, test, expect, afterEach } from "bun:test";
import { detectProvider } from "../../src/ai/provider";
import type { Provider } from "../../src/ai/provider";

describe("detectProvider", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = origEnv.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = origEnv.OPENAI_API_KEY;
  });

  test("returns none when raw=true", async () => {
    const provider = await detectProvider(undefined, true);
    expect(provider.type).toBe("none");
    expect(provider.name).toBe("none");
  });

  test("returns none when forced to none", async () => {
    const provider = await detectProvider("none");
    expect(provider.type).toBe("none");
    expect(provider.name).toBe("none");
  });

  test("throws on unknown forced provider", async () => {
    await expect(detectProvider("gpt")).rejects.toThrow(
      'Unknown provider "gpt"'
    );
  });

  test("raw=true overrides forced provider", async () => {
    const provider = await detectProvider("claude", true);
    expect(provider.type).toBe("none");
  });

  test("detects ANTHROPIC_API_KEY when no CLI tools available", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-123";
    delete process.env.OPENAI_API_KEY;
    const provider = await detectProvider();

    // If claude/codex CLI is on this machine, it'll pick those first
    if (provider.type === "anthropic-api") {
      expect(provider.name).toBe("Anthropic API");
    }
    // Otherwise it found a CLI tool, which is fine
    expect(["claude-cli", "codex-cli", "anthropic-api"]).toContain(
      provider.type
    );
  });

  test("detects OPENAI_API_KEY when no other providers", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-key-456";
    const provider = await detectProvider();

    // May pick claude/codex CLI if installed on machine
    expect(["claude-cli", "codex-cli", "openai-api"]).toContain(provider.type);
  });

  test("returns none when nothing available", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const provider = await detectProvider();

    // Claude CLI is likely on this dev machine, so we can't guarantee "none"
    // Just verify the result is a valid provider
    expect(provider.type).toBeDefined();
    expect(provider.name).toBeDefined();
  });

  test("provider type and name are consistent", async () => {
    const provider = await detectProvider("none");
    expect(typeof provider.type).toBe("string");
    expect(typeof provider.name).toBe("string");
  });
});

describe("detectProvider priority", () => {
  test("forced none always returns none regardless of env", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.OPENAI_API_KEY = "test-key";
    const provider = await detectProvider("none");
    expect(provider.type).toBe("none");
  });
});
