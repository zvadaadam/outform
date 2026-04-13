import { describe, test, expect } from "bun:test";
import {
  formatWebMarkdown,
  formatWebText,
  formatWebJson,
  getWebOutputPath,
  formatPdfMarkdown,
  formatPdfText,
  formatPdfJson,
  getPdfOutputPath,
} from "./formatter";
import type { WebResult } from "../extractors/web";
import type { PdfResult } from "../extractors/pdf";

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

const samplePdfResult: PdfResult = {
  title: "Research Paper on AI",
  pageCount: 12,
  source: "https://arxiv.org/pdf/2301.00001.pdf",
  content: "This is the extracted PDF text content spanning multiple pages.",
};

describe("formatPdfMarkdown", () => {
  test("includes title as h1", () => {
    const md = formatPdfMarkdown(samplePdfResult);
    expect(md).toContain("# Research Paper on AI");
  });

  test("includes source and page count", () => {
    const md = formatPdfMarkdown(samplePdfResult);
    expect(md).toContain("**Source:** https://arxiv.org/pdf/2301.00001.pdf");
    expect(md).toContain("**Pages:** 12");
  });

  test("includes content under Content heading", () => {
    const md = formatPdfMarkdown(samplePdfResult);
    expect(md).toContain("## Content");
    expect(md).toContain("extracted PDF text content");
  });
});

describe("formatPdfText", () => {
  test("uses plain text formatting", () => {
    const txt = formatPdfText(samplePdfResult);
    expect(txt).toContain("Research Paper on AI");
    expect(txt).toContain("Source: https://arxiv.org/pdf/2301.00001.pdf");
    expect(txt).toContain("Pages: 12");
    expect(txt).not.toContain("**");
    expect(txt).not.toContain("#");
  });
});

describe("formatPdfJson", () => {
  test("returns valid JSON with all fields", () => {
    const json = formatPdfJson(samplePdfResult);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("pdf");
    expect(parsed.title).toBe("Research Paper on AI");
    expect(parsed.pageCount).toBe(12);
    expect(parsed.source).toBe("https://arxiv.org/pdf/2301.00001.pdf");
    expect(parsed.content).toContain("extracted PDF text content");
  });
});

describe("getPdfOutputPath", () => {
  test("generates correct path pattern", () => {
    const path = getPdfOutputPath("https://arxiv.org/pdf/2301.00001.pdf");
    expect(path).toMatch(/^\/tmp\/extractor\/pdf-[a-f0-9]{8}\.md$/);
  });

  test("different URLs produce different hashes", () => {
    const path1 = getPdfOutputPath("https://arxiv.org/pdf/2301.00001.pdf");
    const path2 = getPdfOutputPath("https://arxiv.org/pdf/2301.00002.pdf");
    expect(path1).not.toBe(path2);
  });
});
