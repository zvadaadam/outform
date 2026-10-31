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
  formatYouTubeMarkdown,
  formatYouTubeJson,
} from "../../src/output/formatter";
import type { WebResult } from "../../src/extractors/web";
import type { PdfResult } from "../../src/extractors/pdf";
import type { YouTubeResult } from "../../src/extractors/youtube";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sampleResult: WebResult = {
  title: "Test Article",
  author: "John Doe",
  source: "https://example.com/article",
  content: "This is the article body with **some** text content.",
  textContent: "This is the article body with some text content.",
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
  test("uses plain text formatting from textContent", () => {
    const txt = formatWebText(sampleResult);
    expect(txt).toContain("Test Article");
    expect(txt).toContain("Author: John Doe");
    expect(txt).toContain("Source: https://example.com/article");
    expect(txt).toContain("This is the article body with some text content.");
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
    expect(parsed.content).toBe("This is the article body with **some** text content.");
    expect(parsed.excerpt).toBe("A short excerpt.");
  });
});

describe("getWebOutputPath", () => {
  test("generates correct path pattern", () => {
    const path = getWebOutputPath("https://example.com/article");
    expect(path).toMatch(
      new RegExp(
        `^${join(tmpdir(), "outform", "web-example.com-").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-f0-9]{8}\\.md$`,
      ),
    );
  });

  test("strips www from domain", () => {
    const path = getWebOutputPath("https://www.example.com/article");
    expect(path).toMatch(/web-example\.com-/);
  });

  test("uses .json extension for json format", () => {
    const path = getWebOutputPath("https://example.com/article", "json");
    expect(path).toMatch(/\.json$/);
  });

  test("uses .txt extension for txt format", () => {
    const path = getWebOutputPath("https://example.com/article", "txt");
    expect(path).toMatch(/\.txt$/);
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
    expect(path).toMatch(
      new RegExp(`^${join(tmpdir(), "outform", "pdf-").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-f0-9]{8}\\.md$`),
    );
  });

  test("different URLs produce different hashes", () => {
    const path1 = getPdfOutputPath("https://arxiv.org/pdf/2301.00001.pdf");
    const path2 = getPdfOutputPath("https://arxiv.org/pdf/2301.00002.pdf");
    expect(path1).not.toBe(path2);
  });

  test("uses .json extension for json format", () => {
    const path = getPdfOutputPath("https://arxiv.org/pdf/2301.00001.pdf", "json");
    expect(path).toMatch(/\.json$/);
  });

  test("uses .txt extension for txt format", () => {
    const path = getPdfOutputPath("https://arxiv.org/pdf/2301.00001.pdf", "txt");
    expect(path).toMatch(/\.txt$/);
  });
});

describe("source-first output", () => {
  test("web and PDF output omit generated summaries", () => {
    expect(JSON.parse(formatWebJson(sampleResult))).not.toHaveProperty("summary");
    expect(JSON.parse(formatPdfJson(samplePdfResult))).not.toHaveProperty("summary");
    expect(formatWebMarkdown(sampleResult)).not.toContain("## Summary");
    expect(formatPdfMarkdown(samplePdfResult)).not.toContain("## Summary");
  });
  const video: YouTubeResult = {
    videoId: "test123",
    author: "Test channel",
    channelId: null,
    channelUrl: null,
    thumbnail: null,
    uploadDate: null,
    title: "Test video",
    channel: "Test channel",
    description: "Publisher's description",
    source: "https://www.youtube.com/watch?v=test123",
    duration: 120,
    chapters: [
      { title: "Setup", startTime: 0, endTime: 120, description: "The speaker explains the installation steps." },
    ],
    chaptersSource: "generated",
    transcript: "Install the package.",
    transcriptSource: "captions",
    transcriptSegments: [{ startTime: 12, endTime: 14, text: "Install the package." }],
    issues: [],
  };
  test("labels generated chapter descriptions and preserves source text and timing", () => {
    const markdown = formatYouTubeMarkdown(video);
    expect(markdown).toContain("## Chapters (AI-generated)");
    expect(markdown).toContain("The speaker explains the installation steps.");
    expect(markdown).toContain("[0:12]");
    expect(markdown).toContain(video.description);
    const json = JSON.parse(formatYouTubeJson(video));
    expect(json).not.toHaveProperty("summary");
    expect(json.transcriptSegments).toEqual(video.transcriptSegments);
    expect(json.chaptersSource).toBe("generated");
  });
});
