import { describe, test, expect } from "bun:test";
import { summarize } from "./summarize";
import type { Provider } from "./provider";

describe("summarize", () => {
  test("returns null for none provider", async () => {
    const provider: Provider = { type: "none", name: "none" };
    const result = await summarize("Some content to summarize", provider);
    expect(result).toBeNull();
  });

  test("returns null for empty-like none provider", async () => {
    const provider: Provider = { type: "none", name: "none" };
    const result = await summarize("", provider);
    expect(result).toBeNull();
  });

  test("gracefully handles invalid Anthropic API key (returns null)", async () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-invalid-test-key";
    try {
      const provider: Provider = { type: "anthropic-api", name: "Anthropic API" };
      const result = await summarize("test content", provider);
      expect(result).toBeNull();
    } finally {
      if (origKey) {
        process.env.ANTHROPIC_API_KEY = origKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  test("gracefully handles invalid OpenAI API key (returns null)", async () => {
    const origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-invalid-test-key";
    try {
      const provider: Provider = { type: "openai-api", name: "OpenAI API" };
      const result = await summarize("test content", provider);
      expect(result).toBeNull();
    } finally {
      if (origKey) {
        process.env.OPENAI_API_KEY = origKey;
      } else {
        delete process.env.OPENAI_API_KEY;
      }
    }
  });
});
