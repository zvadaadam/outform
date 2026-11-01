import { describe, expect, test } from "bun:test";
import { parseMediaInfo } from "../../src/extractors/media/yt-dlp";
import { parseTikTokSlides } from "../../src/extractors/media/tiktok";
import { parsePinterestGallery } from "../../src/extractors/media/pinterest";
import { formatMediaMarkdown, formatMediaText } from "../../src/output/formatter";

const source = "https://www.instagram.com/p/example/";
const image = {
  id: "photo",
  thumbnails: [{ url: "https://cdn.example/small.jpg" }, { url: "https://cdn.example/original.jpg" }],
};
const video = {
  id: "movie",
  formats: [{ url: "https://cdn.example/video.mp4", vcodec: "h264", acodec: "aac" }],
  duration: 24,
};

describe("social media metadata", () => {
  test("preserves mixed carousel order, caption, author and missing-item positions", () => {
    const result = parseMediaInfo(
      {
        id: "post",
        title: "A post",
        description: "First paragraph\n\nSecond",
        uploader: "Creator",
        upload_date: "20261101",
        entries: [image, null, video],
      },
      source,
      "instagram",
    );
    expect(result.media.map(({ kind, index }) => [kind, index])).toEqual([
      ["image", 1],
      ["video", 3],
    ]);
    expect(result.media[0]?.url).toBe("https://cdn.example/original.jpg");
    expect(result.issues).toHaveLength(1);
    expect(result.author).toBe("Creator");
    expect(result.uploadDate).toBe("2026-11-01");
    expect(formatMediaMarkdown(result)).toContain("First paragraph\n\nSecond");
    expect(formatMediaText(result)).toContain(source);
  });

  test("returns a direct link for an intentionally silent video", () => {
    const result = parseMediaInfo(
      {
        id: "silent",
        formats: [
          { url: "https://cdn.example/small.mp4", protocol: "https", vcodec: "h264", acodec: "none" },
          { url: "https://cdn.example/full.mp4", protocol: "https", vcodec: "h264", acodec: "none" },
        ],
      },
      source,
      "instagram",
    );
    expect(result.media[0]?.kind).toBe("video");
    expect(result.media[0]?.url).toBe("https://cdn.example/full.mp4");
    expect(formatMediaMarkdown(result)).toContain("https://cdn.example/full.mp4");
  });

  test("does not present a silent stream as the full video when separate audio exists", () => {
    const formats = [
      { url: "https://cdn.example/audio.m4a", protocol: "https", vcodec: "none", acodec: "aac" },
      { url: "https://cdn.example/video.mp4", protocol: "https", vcodec: "h264", acodec: "none" },
    ];
    expect(parseMediaInfo({ formats }, source, "instagram").media[0]?.url).toBeNull();
    expect(
      parseMediaInfo(
        {
          formats: [
            { url: "https://cdn.example/complete.mp4", protocol: "https", vcodec: "h264", acodec: "aac" },
            ...formats,
          ],
        },
        source,
        "instagram",
      ).media[0]?.url,
    ).toBe("https://cdn.example/complete.mp4");
  });

  test("uses the selected original instead of a small thumbnail", () => {
    const result = parseMediaInfo(
      { ...image, thumbnail: "https://cdn.example/original.jpg", title: "Video by creator" },
      source,
      "instagram",
    );
    expect(result.media[0]?.url).toBe("https://cdn.example/original.jpg");
    expect(result.title).toBe("Post by creator");
  });

  test("does not turn an unavailable Reel or DRM video into an image", () => {
    expect(parseMediaInfo(image, "https://www.instagram.com/reel/example/", "instagram").media).toEqual([]);
    expect(parseMediaInfo({ ...image, _has_drm: true }, source, "instagram").media).toEqual([]);
    expect(parseMediaInfo({ ...image, duration: 10 }, source, "instagram").media).toEqual([]);
  });

  test("distinguishes soundtrack from video and ignores unsafe URLs", () => {
    const result = parseMediaInfo(
      { id: "song", formats: [{ url: "https://cdn.example/audio.mp4", vcodec: "none", acodec: "aac" }] },
      source,
      "tiktok",
    );
    expect(result.media[0]?.kind).toBe("audio");
    expect(parseMediaInfo({ thumbnails: [{ url: "file:///etc/passwd" }] }, source, "instagram").media).toEqual([]);
  });

  test("extracts every TikTok slide and ignores private or missing posts", () => {
    const item = {
      id: "123",
      imagePost: {
        images: [1, 2].map((n) => ({
          imageURL: { urlList: [`https://cdn.example/${n}.jpg`] },
          imageWidth: 1080,
          imageHeight: 1920,
        })),
      },
    };
    const html = (value: unknown) =>
      `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct: value } } } })}</script>`;
    const entries = parseTikTokSlides(html(item));
    const result = parseMediaInfo({ entries }, source, "tiktok");
    expect(result.media.map((m) => [m.kind, m.width, m.url])).toEqual([
      ["image", 1080, "https://cdn.example/1.jpg"],
      ["image", 1080, "https://cdn.example/2.jpg"],
    ]);
    expect(parseTikTokSlides(html({ ...item, privateItem: true }))).toEqual([]);
    expect(parseTikTokSlides("<html>Login</html>")).toEqual([]);
  });

  test("Pinterest galleries include images and video in order, not page posters", () => {
    const gallery = parsePinterestGallery({
      id: "123",
      story_pin_data: {
        page_count: 3,
        pages: [
          { blocks: [{ image: { images: { originals: { url: "https://cdn.example/1.jpg", width: 1080 } } } }] },
          {
            video: { video_list: { best: { url: "https://cdn.example/2.mp4", width: 1080 } } },
            blocks: [{ image: { images: { originals: { url: "https://cdn.example/poster.jpg" } } } }],
          },
        ],
      },
    });
    expect(gallery).toHaveLength(3);
    const result = parseMediaInfo({ entries: gallery }, "https://www.pinterest.com/pin/123/", "pinterest");
    expect(result.media.map((m) => m.kind)).toEqual(["image", "video"]);
    expect(result.issues).toHaveLength(1);
    expect(parsePinterestGallery({ id: "ordinary" })).toBeNull();
  });
  test("Pinterest video overlays are not media and original video metadata survives normalization", () => {
    const gallery = parsePinterestGallery({
      id: "123",
      story_pin_data: {
        pages: [
          {
            blocks: [
              {
                type: "story_pin_video_block",
                video: {
                  video_list: {
                    low: {
                      url: "https://cdn.example/low.mp4",
                      width: 320,
                      height: 569,
                      duration: 14900,
                      thumbnail: "https://cdn.example/low.jpg",
                    },
                    high: {
                      url: "https://cdn.example/high.mp4",
                      width: 640,
                      height: 1138,
                      duration: 14900,
                      thumbnail: "https://cdn.example/high.jpg",
                    },
                  },
                },
              },
              { type: "story_pin_paragraph_block", text: "follow now" },
            ],
          },
          { blocks: [{ type: "story_pin_paragraph_block", text: "Text-only page" }] },
        ],
      },
    });
    expect(gallery).toHaveLength(1);
    const result = parseMediaInfo({ entries: gallery }, "https://www.pinterest.com/pin/123/", "pinterest");
    expect(result.issues).toEqual([]);
    expect(result.media[0]).toMatchObject({
      kind: "video",
      width: 640,
      height: 1138,
      duration: 14.9,
      thumbnail: "https://cdn.example/high.jpg",
      url: "https://cdn.example/high.mp4",
    });
  });

  test("Pinterest missing media blocks still report issues while text overlays are ignored", () => {
    const gallery = parsePinterestGallery({
      id: "123",
      story_pin_data: {
        pages: [
          {
            blocks: [
              { type: "story_pin_paragraph_block", text: "Overlay" },
              { type: "story_pin_video_block", video: {} },
              { type: "story_pin_image_block", image: {} },
            ],
          },
        ],
      },
    });
    expect(gallery).toHaveLength(2);
    const result = parseMediaInfo({ entries: gallery }, "https://www.pinterest.com/pin/123/", "pinterest");
    expect(result.media).toEqual([]);
    expect(result.issues).toHaveLength(2);
  });
});
