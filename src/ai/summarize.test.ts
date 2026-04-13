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
});
