import { describe, test, expect } from "bun:test";
import { extractWeb } from "../../src/extractors/web";

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

  test("content is markdown with document structure preserved", async () => {
    const result = await extractWeb("https://paulgraham.com/superlinear.html");

    expect(result.content).toContain("[");
    expect(result.content).not.toContain("<p>");
    expect(result.content).not.toContain("<a ");
    expect(result.content).not.toContain("<span");
  });

  test("textContent is plain text without markdown formatting", async () => {
    const result = await extractWeb("https://paulgraham.com/superlinear.html");

    expect(result.textContent).toBeTruthy();
    expect(result.textContent.length).toBeGreaterThan(500);
    expect(result.textContent).not.toContain("](");
    expect(result.textContent).not.toContain("<div");
  });

  test("throws on non-existent page", async () => {
    await expect(extractWeb("https://example.com/this-page-does-not-exist-at-all-404")).rejects.toThrow();
  });

  test("throws friendly error for unresolvable hostname", async () => {
    await expect(extractWeb("https://this-domain-does-not-exist-zzz.invalid/page")).rejects.toThrow(
      /Could not resolve hostname|Connection refused/,
    );
  });

  test("throws friendly error for connection refused", async () => {
    await expect(extractWeb("http://localhost:1/page")).rejects.toThrow(
      /Connection refused|Could not resolve hostname/,
    );
  });
});
