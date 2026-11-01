import { describe, expect, test } from "bun:test";
import { detectUrlType, extractYouTubeId, extractDomain, isValidUrl } from "../../src/utils/url";

describe("detectUrlType", () => {
  test("detects standard YouTube URLs", () => {
    expect(detectUrlType("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("youtube");
    expect(detectUrlType("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe("youtube");
  });

  test("detects short YouTube URLs", () => {
    expect(detectUrlType("https://youtu.be/dQw4w9WgXcQ")).toBe("youtube");
  });

  test("detects YouTube embed URLs", () => {
    expect(detectUrlType("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("youtube");
  });

  test("detects YouTube shorts URLs", () => {
    expect(detectUrlType("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("youtube");
  });

  test("detects mobile YouTube URLs (m.youtube.com)", () => {
    expect(detectUrlType("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("youtube");
  });

  test("detects YouTube Music URLs (music.youtube.com)", () => {
    expect(detectUrlType("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("youtube");
  });

  test("detects YouTube live URLs", () => {
    expect(detectUrlType("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe("youtube");
  });

  test("detects PDF URLs", () => {
    expect(detectUrlType("https://arxiv.org/pdf/2301.00001.pdf")).toBe("pdf");
    expect(detectUrlType("https://example.com/doc.pdf?v=2")).toBe("pdf");
  });

  test("detects web URLs", () => {
    expect(detectUrlType("https://paulgraham.com/superlinear.html")).toBe("web");
    expect(detectUrlType("https://example.com")).toBe("web");
  });
});

describe("extractYouTubeId", () => {
  test("extracts from standard URL", () => {
    expect(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  test("extracts from short URL", () => {
    expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  test("extracts from embed URL", () => {
    expect(extractYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  test("extracts from mobile URL (m.youtube.com)", () => {
    expect(extractYouTubeId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  test("extracts from music URL (music.youtube.com)", () => {
    expect(extractYouTubeId("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  test("extracts from live URL", () => {
    expect(extractYouTubeId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
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
    expect(extractDomain("https://paulgraham.com/superlinear.html")).toBe("paulgraham.com");
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

describe("social post routing", () => {
  test.each([
    "https://www.instagram.com/reel/DfAZMAjseOQ/?tracking=1",
    "https://www.instagram.com/creator/p/abc/",
    "https://x.com/creator/status/123",
    "https://twitter.com/i/web/status/123",
    "https://www.tiktok.com/@creator/photo/123",
    "https://vm.tiktok.com/abc/",
    "https://jp.pinterest.com/pin/123/",
    "https://www.pinterest.co.uk/pin/title--123/",
    "https://pin.it/abc",
    "https://www.facebook.com/video.php?v=123",
    "https://www.facebook.com/creator/videos/123/",
    "https://old.reddit.com/r/test/comments/abc/title/",
    "https://vimeo.com/123",
  ])("routes %s to media", (url) => expect(detectUrlType(url)).toBe("media"));

  test.each([
    "https://www.instagram.com/creator/",
    "https://x.com/creator",
    "https://pinterest.com/creator/board/",
    "https://instagram.com.example.org/p/abc/",
    "https://fakepinterest.com/pin/123/",
    "https://example.com/?url=https://instagram.com/p/abc/",
  ])("does not treat %s as a supported post", (url) => expect(detectUrlType(url)).toBe("web"));
});
