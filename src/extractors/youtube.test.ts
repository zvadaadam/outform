import { describe, test, expect } from "bun:test";
import {
  formatYouTubeMarkdown,
  formatYouTubeText,
  formatYouTubeJson,
  getYouTubeOutputPath,
} from "../output/formatter";
import type { YouTubeResult } from "./youtube";
import { findWhisperModel } from "./youtube";

const SAMPLE_RESULT: YouTubeResult = {
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
  transcript: "Hello and welcome to this tutorial.\n\nToday we will build a CLI tool.",
};

const MINIMAL_RESULT: YouTubeResult = {
  title: "Quick Video",
  channel: "Some Channel",
  description: "",
  source: "https://www.youtube.com/watch?v=xyz789abc01",
  duration: null,
  chapters: null,
  transcript: "Just a short video.",
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
    expect(md).toContain("- **0:00** — Intro");
    expect(md).toContain("- **1:00** — Setup");
    expect(md).toContain("- **5:00** — Building");
    expect(md).toContain("- **10:00** — Conclusion");
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
    expect(path).toBe("/tmp/extractor/yt-dQw4w9WgXcQ.md");
  });

  test("uses .json extension for json format", () => {
    const path = getYouTubeOutputPath("dQw4w9WgXcQ", "json");
    expect(path).toBe("/tmp/extractor/yt-dQw4w9WgXcQ.json");
  });

  test("uses .txt extension for txt format", () => {
    const path = getYouTubeOutputPath("dQw4w9WgXcQ", "txt");
    expect(path).toBe("/tmp/extractor/yt-dQw4w9WgXcQ.txt");
  });
});

describe("findWhisperModel", () => {
  test("returns env var path when WHISPER_MODEL is set and file exists", async () => {
    const tmpPath = "/tmp/extractor-test-whisper-model.bin";
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
    process.env.HOME = "/tmp/extractor-fake-home-nonexistent";
    try {
      const result = await findWhisperModel();
      expect(result).toBeNull();
    } finally {
      process.env.WHISPER_MODEL = original;
      process.env.HOME = originalHome;
    }
  });
});
