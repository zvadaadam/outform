import { describe, test, expect } from "bun:test";
import { extractWeb } from "./web";

describe("extractWeb", () => {
  test("extracts article content from a real web page", async () => {
    const result = await extractWeb("https://paulgraham.com/superlinear.html");

    expect(result.title).toBeTruthy();
    expect(result.source).toBe("https://paulgraham.com/superlinear.html");
    expect(result.content).toBeTruthy();
    expect(result.content.length).toBeGreaterThan(500);
    expect(result.content).not.toContain("<script");
    expect(result.content).not.toContain("<div");
  });

  test("throws on non-existent page", async () => {
    await expect(
      extractWeb("https://example.com/this-page-does-not-exist-at-all-404")
    ).rejects.toThrow();
  });
});
