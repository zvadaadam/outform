import { describe, test, expect } from "bun:test";
import {
  formatWebMarkdown,
  formatWebText,
  formatWebJson,
  getWebOutputPath,
} from "./formatter";
import type { WebResult } from "../extractors/web";

const sampleResult: WebResult = {
  title: "Test Article",
  author: "John Doe",
  source: "https://example.com/article",
  content: "This is the article body with some text content.",
  excerpt: "A short excerpt.",
};

describe("formatWebMarkdown", () => {
  test("includes title as h1", () => {
    const md = formatWebMarkdown(sampleResult);
    expect(md).toContain("# Test Article");
  });

  test("includes author and source", () => {
    const md = formatWebMarkdown(sampleResult);
    expect(md).toContain("**Author:** John Doe");
    expect(md).toContain("**Source:** https://example.com/article");
  });

  test("includes content under Content heading", () => {
    const md = formatWebMarkdown(sampleResult);
    expect(md).toContain("## Content");
    expect(md).toContain("This is the article body");
  });

  test("omits author when null", () => {
    const result = { ...sampleResult, author: null };
    const md = formatWebMarkdown(result);
    expect(md).not.toContain("**Author:**");
  });
});

describe("formatWebText", () => {
  test("uses plain text formatting", () => {
    const txt = formatWebText(sampleResult);
    expect(txt).toContain("Test Article");
    expect(txt).toContain("Author: John Doe");
    expect(txt).toContain("Source: https://example.com/article");
    expect(txt).not.toContain("**");
    expect(txt).not.toContain("#");
  });
});

describe("formatWebJson", () => {
  test("returns valid JSON with all fields", () => {
    const json = formatWebJson(sampleResult);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("web");
    expect(parsed.title).toBe("Test Article");
    expect(parsed.author).toBe("John Doe");
    expect(parsed.source).toBe("https://example.com/article");
    expect(parsed.content).toBe(
      "This is the article body with some text content."
    );
    expect(parsed.excerpt).toBe("A short excerpt.");
  });
});

describe("getWebOutputPath", () => {
  test("generates correct path pattern", () => {
    const path = getWebOutputPath("https://example.com/article");
    expect(path).toMatch(/^\/tmp\/extractor\/web-example\.com-[a-f0-9]{8}\.md$/);
  });

  test("strips www from domain", () => {
    const path = getWebOutputPath("https://www.example.com/article");
    expect(path).toMatch(/web-example\.com-/);
  });
});
