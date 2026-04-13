import { describe, expect, test } from "bun:test";
import {
  detectUrlType,
  extractYouTubeId,
  extractDomain,
  isValidUrl,
} from "./url";

describe("detectUrlType", () => {
  test("detects standard YouTube URLs", () => {
    expect(
      detectUrlType("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("youtube");
    expect(detectUrlType("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "youtube",
    );
  });

  test("detects short YouTube URLs", () => {
    expect(detectUrlType("https://youtu.be/dQw4w9WgXcQ")).toBe("youtube");
  });

  test("detects YouTube embed URLs", () => {
    expect(
      detectUrlType("https://www.youtube.com/embed/dQw4w9WgXcQ"),
    ).toBe("youtube");
  });

  test("detects YouTube shorts URLs", () => {
    expect(
      detectUrlType("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
    ).toBe("youtube");
  });

  test("detects mobile YouTube URLs (m.youtube.com)", () => {
    expect(
      detectUrlType("https://m.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("youtube");
  });

  test("detects YouTube Music URLs (music.youtube.com)", () => {
    expect(
      detectUrlType("https://music.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("youtube");
  });

  test("detects YouTube live URLs", () => {
    expect(
      detectUrlType("https://www.youtube.com/live/dQw4w9WgXcQ"),
    ).toBe("youtube");
  });

  test("detects PDF URLs", () => {
    expect(detectUrlType("https://arxiv.org/pdf/2301.00001.pdf")).toBe("pdf");
    expect(detectUrlType("https://example.com/doc.pdf?v=2")).toBe("pdf");
  });

  test("detects web URLs", () => {
    expect(detectUrlType("https://paulgraham.com/superlinear.html")).toBe(
      "web",
    );
    expect(detectUrlType("https://example.com")).toBe("web");
  });
});

describe("extractYouTubeId", () => {
  test("extracts from standard URL", () => {
    expect(
      extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
  });

  test("extracts from short URL", () => {
    expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  test("extracts from embed URL", () => {
    expect(
      extractYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
  });

  test("extracts from mobile URL (m.youtube.com)", () => {
    expect(
      extractYouTubeId("https://m.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
  });

  test("extracts from music URL (music.youtube.com)", () => {
    expect(
      extractYouTubeId("https://music.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
  });

  test("extracts from live URL", () => {
    expect(
      extractYouTubeId("https://www.youtube.com/live/dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
  });

  test("returns null for non-YouTube URL", () => {
    expect(extractYouTubeId("https://example.com")).toBeNull();
  });
});

describe("extractDomain", () => {
  test("extracts domain without www", () => {
    expect(extractDomain("https://www.example.com/page")).toBe("example.com");
  });

  test("extracts domain from simple URL", () => {
    expect(extractDomain("https://paulgraham.com/superlinear.html")).toBe(
      "paulgraham.com",
    );
  });

  test("returns unknown for invalid URL", () => {
    expect(extractDomain("not a url")).toBe("unknown");
  });
});

describe("isValidUrl", () => {
  test("accepts valid URLs", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
    expect(isValidUrl("http://localhost:3000")).toBe(true);
  });

  test("rejects invalid URLs", () => {
    expect(isValidUrl("not a url")).toBe(false);
    expect(isValidUrl("")).toBe(false);
  });
});
