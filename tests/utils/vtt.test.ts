import { describe, test, expect } from "bun:test";
import { stripVttTimestamps, parseChapters, formatTimestamp } from "../../src/utils/vtt";

describe("stripVttTimestamps", () => {
  test("strips VTT header and timestamps", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
Hello world.

00:00:02.000 --> 00:00:04.000
This is a test.`;

    const result = stripVttTimestamps(vtt);
    expect(result).toBe("Hello world.\n\nThis is a test.");
  });

  test("strips SRT timestamps and indices", () => {
    const srt = `1
00:00:00,000 --> 00:00:02,000
First line.

2
00:00:02,000 --> 00:00:04,000
Second line.`;

    const result = stripVttTimestamps(srt);
    expect(result).toBe("First line.\n\nSecond line.");
  });

  test("deduplicates repeated lines", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
Hello world.

00:00:01.000 --> 00:00:03.000
Hello world.

00:00:03.000 --> 00:00:05.000
Something new.`;

    const result = stripVttTimestamps(vtt);
    expect(result).toBe("Hello world.\n\nSomething new.");
  });

  test("strips HTML-like cue tags", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
<c.colorCCCCCC>Hello</c> <c.colorE5E5E5>world.</c>`;

    const result = stripVttTimestamps(vtt);
    expect(result).toBe("Hello world.");
  });

  test("merges lines into paragraphs at sentence boundaries", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
This is the first

00:00:01.000 --> 00:00:02.000
part of a sentence.

00:00:02.000 --> 00:00:03.000
And this is another.`;

    const result = stripVttTimestamps(vtt);
    expect(result).toBe(
      "This is the first part of a sentence.\n\nAnd this is another."
    );
  });

  test("handles empty input", () => {
    expect(stripVttTimestamps("")).toBe("");
    expect(stripVttTimestamps("WEBVTT\n\n")).toBe("");
  });

  test("strips NOTE blocks", () => {
    const vtt = `WEBVTT

NOTE This is a comment

00:00:00.000 --> 00:00:02.000
Actual content.`;

    const result = stripVttTimestamps(vtt);
    expect(result).toBe("Actual content.");
  });

  test("handles question marks and exclamation points as sentence boundaries", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
What is this?

00:00:01.000 --> 00:00:02.000
That is amazing!

00:00:02.000 --> 00:00:03.000
Indeed.`;

    const result = stripVttTimestamps(vtt);
    expect(result).toBe("What is this?\n\nThat is amazing!\n\nIndeed.");
  });
});

describe("parseChapters", () => {
  test("parses chapters from yt-dlp metadata", () => {
    const metadata = {
      chapters: [
        { title: "Intro", start_time: 0, end_time: 60 },
        { title: "Main Topic", start_time: 60, end_time: 300 },
        { title: "Conclusion", start_time: 300, end_time: 420 },
      ],
    };

    const chapters = parseChapters(metadata)!;
    expect(chapters).toHaveLength(3);
    expect(chapters[0]).toEqual({
      title: "Intro",
      startTime: 0,
      endTime: 60,
    });
    expect(chapters[2]!.title).toBe("Conclusion");
  });

  test("returns null when no chapters", () => {
    expect(parseChapters({})).toBeNull();
    expect(parseChapters({ chapters: [] })).toBeNull();
    expect(parseChapters({ chapters: null })).toBeNull();
  });

  test("handles missing title in chapters", () => {
    const metadata = {
      chapters: [{ start_time: 0, end_time: 60 }],
    };

    const chapters = parseChapters(metadata)!;
    expect(chapters[0]!.title).toBe("Untitled");
  });
});

describe("formatTimestamp", () => {
  test("formats seconds to mm:ss", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(599)).toBe("9:59");
  });

  test("formats with hours when >= 3600", () => {
    expect(formatTimestamp(3600)).toBe("1:00:00");
    expect(formatTimestamp(3661)).toBe("1:01:01");
    expect(formatTimestamp(7200)).toBe("2:00:00");
  });
});
