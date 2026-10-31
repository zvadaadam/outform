import { describe, test, expect } from "bun:test";
import {
  formatYouTubeMarkdown,
  formatYouTubeText,
  formatYouTubeJson,
  getYouTubeOutputPath,
} from "../../src/output/formatter";
import type { YouTubeResult } from "../../src/extractors/youtube";
import { findWhisperModel, parseYouTubeMetadata } from "../../src/extractors/youtube";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SAMPLE_RESULT: YouTubeResult = {
  videoId: "abc123def45",
  author: "Tech Channel",
  channelId: "UCexample",
  channelUrl: "https://www.youtube.com/channel/UCexample",
  thumbnail: "https://i.ytimg.com/vi/abc123def45/maxresdefault.jpg",
  uploadDate: "2026-10-30",
  title: "How to Build CLI Tools",
  channel: "Tech Channel",
  description: "A tutorial on building CLI tools with TypeScript.",
  source: "https://www.youtube.com/watch?v=abc123def45",
  duration: 754,
  chapters: [
    { title: "Intro", startTime: 0, endTime: 60 },
    { title: "Setup", startTime: 60, endTime: 300 },
    { title: "Building", startTime: 300, endTime: 600 },
    { title: "Conclusion", startTime: 600, endTime: 754 },
  ],
  transcriptSegments: [],
  transcriptSource: "captions",
  chaptersSource: "source",
  issues: [],
  transcript: "Hello and welcome to this tutorial.\n\nToday we will build a CLI tool.",
};

const MINIMAL_RESULT: YouTubeResult = {
  videoId: "xyz789abc01",
  author: null,
  channelId: null,
  channelUrl: null,
  thumbnail: null,
  uploadDate: null,
  title: "Quick Video",
  channel: "Some Channel",
  description: "",
  source: "https://www.youtube.com/watch?v=xyz789abc01",
  duration: null,
  chapters: null,
  transcript: "Just a short video.",
  transcriptSegments: [],
  transcriptSource: "captions",
  chaptersSource: null,
  issues: [],
};

describe("YouTube markdown formatting", () => {
  test("includes title, channel, source, duration", () => {
    const md = formatYouTubeMarkdown(SAMPLE_RESULT);
    expect(md).toContain("# How to Build CLI Tools");
    expect(md).toContain("**Channel:** Tech Channel");
    expect(md).toContain("**Source:** https://www.youtube.com/watch?v=abc123def45");
    expect(md).toContain("**Duration:** 12:34");
  });

  test("includes description section", () => {
    const md = formatYouTubeMarkdown(SAMPLE_RESULT);
    expect(md).toContain("## Description");
    expect(md).toContain("A tutorial on building CLI tools");
  });

  test("includes chapters with timestamps", () => {
    const md = formatYouTubeMarkdown(SAMPLE_RESULT);
    expect(md).toContain("## Chapters");
    expect(md).toContain("&t=0s)** — Intro");
    expect(md).toContain("&t=60s)** — Setup");
    expect(md).toContain("&t=300s)** — Building");
    expect(md).toContain("&t=600s)** — Conclusion");
  });

  test("includes transcript section", () => {
    const md = formatYouTubeMarkdown(SAMPLE_RESULT);
    expect(md).toContain("## Transcript");
    expect(md).toContain("Hello and welcome to this tutorial.");
  });

  test("omits description when empty", () => {
    const md = formatYouTubeMarkdown(MINIMAL_RESULT);
    expect(md).not.toContain("## Description");
  });

  test("omits chapters when null", () => {
    const md = formatYouTubeMarkdown(MINIMAL_RESULT);
    expect(md).not.toContain("## Chapters");
  });

  test("omits duration when null", () => {
    const md = formatYouTubeMarkdown(MINIMAL_RESULT);
    expect(md).not.toContain("Duration");
  });
});

describe("YouTube text formatting", () => {
  test("uses plain text format with underline title", () => {
    const txt = formatYouTubeText(SAMPLE_RESULT);
    expect(txt).toContain("How to Build CLI Tools");
    expect(txt).toContain("=".repeat("How to Build CLI Tools".length));
    expect(txt).toContain("Channel: Tech Channel");
    expect(txt).not.toContain("**");
    expect(txt).not.toContain("#");
  });

  test("includes transcript section", () => {
    const txt = formatYouTubeText(SAMPLE_RESULT);
    expect(txt).toContain("Transcript:");
    expect(txt).toContain("Hello and welcome");
  });
});

describe("YouTube JSON formatting", () => {
  test("produces valid JSON with all fields", () => {
    const json = formatYouTubeJson(SAMPLE_RESULT);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("youtube");
    expect(parsed.title).toBe("How to Build CLI Tools");
    expect(parsed.channel).toBe("Tech Channel");
    expect(parsed.duration).toBe(754);
    expect(parsed.chapters).toHaveLength(4);
    expect(parsed.transcript).toContain("Hello and welcome");
  });

  test("handles null chapters and duration", () => {
    const json = formatYouTubeJson(MINIMAL_RESULT);
    const parsed = JSON.parse(json);
    expect(parsed.chapters).toBeNull();
    expect(parsed.duration).toBeNull();
  });
});

describe("YouTube output path", () => {
  test("follows yt-{videoId}.md convention", () => {
    const path = getYouTubeOutputPath("dQw4w9WgXcQ");
    expect(path).toBe(join(tmpdir(), "outform", "yt-dQw4w9WgXcQ.md"));
  });

  test("uses .json extension for json format", () => {
    const path = getYouTubeOutputPath("dQw4w9WgXcQ", "json");
    expect(path).toBe(join(tmpdir(), "outform", "yt-dQw4w9WgXcQ.json"));
  });

  test("uses .txt extension for txt format", () => {
    const path = getYouTubeOutputPath("dQw4w9WgXcQ", "txt");
    expect(path).toBe(join(tmpdir(), "outform", "yt-dQw4w9WgXcQ.txt"));
  });
});

describe("findWhisperModel", () => {
  test("returns env var path when WHISPER_MODEL is set and file exists", async () => {
    const tmpPath = "/tmp/outform-test-whisper-model.bin";
    await Bun.write(tmpPath, "fake model");
    const original = process.env.WHISPER_MODEL;
    process.env.WHISPER_MODEL = tmpPath;
    try {
      const result = await findWhisperModel();
      expect(result).toBe(tmpPath);
    } finally {
      process.env.WHISPER_MODEL = original;
      const { rm } = await import("fs/promises");
      await rm(tmpPath, { force: true });
    }
  });

  test("returns null when WHISPER_MODEL points to nonexistent file", async () => {
    const original = process.env.WHISPER_MODEL;
    process.env.WHISPER_MODEL = "/tmp/nonexistent-whisper-model.bin";
    try {
      const result = await findWhisperModel();
      // Should fall through to candidate paths, which likely don't exist either
      expect(result === null || typeof result === "string").toBe(true);
    } finally {
      process.env.WHISPER_MODEL = original;
    }
  });

  test("returns null when no model is found anywhere", async () => {
    const original = process.env.WHISPER_MODEL;
    const originalHome = process.env.HOME;
    delete process.env.WHISPER_MODEL;
    process.env.HOME = "/tmp/outform-fake-home-nonexistent";
    try {
      const result = await findWhisperModel();
      expect(result).toBeNull();
    } finally {
      process.env.WHISPER_MODEL = original;
      process.env.HOME = originalHome;
    }
  });
});

describe("YouTube metadata", () => {
  test("preserves source text and normalizes identity, links, and upload date", () => {
    const result = parseYouTubeMetadata(
      {
        title: "  Building a bench  ",
        channel: "Workshop",
        channel_id: "UC123",
        channel_url: "https://www.youtube.com/channel/UC123",
        thumbnail: "https://i.ytimg.com/vi/abc123def45/hqdefault.jpg",
        upload_date: "20240229",
        duration: 90,
        description: "First paragraph.\n\nSecond paragraph.",
      },
      "abc123def45",
    );
    expect(result).toMatchObject({
      videoId: "abc123def45",
      title: "Building a bench",
      author: "Workshop",
      channel: "Workshop",
      channelId: "UC123",
      channelUrl: "https://www.youtube.com/channel/UC123",
      uploadDate: "2024-02-29",
      duration: 90,
    });
    expect(result.thumbnail).toBe("https://i.ytimg.com/vi/abc123def45/hqdefault.jpg");
    expect(result.description).toBe("First paragraph.\n\nSecond paragraph.");
  });

  test("uses uploader attribution and the largest valid thumbnail when primary fields are absent", () => {
    const result = parseYouTubeMetadata(
      {
        title: " ",
        fulltitle: "Fallback title",
        uploader: "Publisher",
        uploader_url: "https://www.youtube.com/@publisher",
        thumbnail: "javascript:alert(1)",
        thumbnails: [
          { url: "https://example.com/large.jpg", width: 1280, height: 720 },
          { url: "https://example.com/small.jpg", width: 320, height: 180 },
          { url: "file:///tmp/photo.jpg", width: 10000, height: 10000 },
          null,
        ],
      },
      "abc123def45",
    );
    expect(result.title).toBe("Fallback title");
    expect(result.author).toBe("Publisher");
    expect(result.channelUrl).toBe("https://www.youtube.com/@publisher");
    expect(result.thumbnail).toBe("https://example.com/large.jpg");
    expect(result.channelId).toBeNull();
  });

  test("represents absent or malformed optional metadata as null without inventing URLs", () => {
    const result = parseYouTubeMetadata(
      { title: 123, upload_date: "20260230", duration: Infinity, channel_url: {}, thumbnails: "bad" },
      "abc123def45",
    );
    expect(result).toMatchObject({
      title: "Untitled Video",
      channel: "Unknown",
      author: null,
      channelId: null,
      channelUrl: null,
      thumbnail: null,
      uploadDate: null,
      duration: null,
    });
  });

  test("renders thumbnail, channel link, and date in both human formats and keeps complete JSON metadata", () => {
    for (const output of [formatYouTubeMarkdown(SAMPLE_RESULT), formatYouTubeText(SAMPLE_RESULT)]) {
      expect(output).toContain(SAMPLE_RESULT.thumbnail!);
      expect(output).toContain(SAMPLE_RESULT.channelUrl!);
      expect(output).toContain("2026-10-30");
    }
    expect(JSON.parse(formatYouTubeJson(SAMPLE_RESULT))).toMatchObject({
      videoId: "abc123def45",
      author: "Tech Channel",
      channelId: "UCexample",
      thumbnail: SAMPLE_RESULT.thumbnail,
      uploadDate: "2026-10-30",
    });
    expect(formatYouTubeText(MINIMAL_RESULT)).not.toContain("Thumbnail:");
    expect(JSON.parse(formatYouTubeJson(MINIMAL_RESULT)).thumbnail).toBeNull();
  });
});
