import { describe, test, expect } from "bun:test";
import {
  stripVttTimestamps,
  parseChapters,
  formatTimestamp,
  parseTranscriptSegments,
  parseWhisperSegments,
  transcriptText,
} from "../../src/utils/vtt";

describe("timed transcripts", () => {
  test("parses SRT and VTT, decoding text without losing cue timing", () => {
    expect(parseTranscriptSegments("1\r\n00:01:02,250 --> 00:01:05,000\r\nHello &amp; <b>goodbye</b> &#33;")).toEqual([
      { startTime: 62.25, endTime: 65, text: "Hello & goodbye !" },
    ]);
    expect(
      parseTranscriptSegments(
        "WEBVTT\nKind: captions\n\nNOTE ignored\n\n00:02.000 --> 00:03.500 align:start\nUseful words.",
      ),
    ).toEqual([{ startTime: 2, endTime: 3.5, text: "Useful words." }]);
  });

  test("removes rolling caption repetition but keeps later repeated speech", () => {
    const segments = parseTranscriptSegments(`WEBVTT

00:00.000 --> 00:02.000
This <00:00.500>is

00:02.000 --> 00:04.000
This is <00:02.500>a rolling

00:04.000 --> 00:06.000
This is a rolling <00:04.500>caption.

00:08.000 --> 00:10.000
This is a rolling caption.`);
    expect(segments.map((s) => s.text)).toEqual(["This is", "a rolling", "caption.", "This is a rolling caption."]);
    expect(transcriptText(segments)).toBe("This is a rolling caption.\n\nThis is a rolling caption.");
    expect(segments[2]!.startTime).toBe(4);
  });

  test("preserves repeated speech across ordinary adjacent publisher captions", () => {
    const segments = parseTranscriptSegments(
      "00:00.000 --> 00:01.000\nThey said go\n\n00:01.000 --> 00:02.000\ngo now.",
    );
    expect(transcriptText(segments)).toBe("They said go go now.");
  });

  test("rejects invalid or out-of-order cues and chapter boundaries", () => {
    expect(
      parseTranscriptSegments(
        "00:03.000 --> 00:02.000\nInvalid\n\n00:02.000 --> 00:04.000\nValid\n\n00:01.000 --> 00:03.000\nOld",
      ),
    ).toEqual([{ startTime: 2, endTime: 4, text: "Valid" }]);
    expect(
      parseChapters({
        chapters: [
          null,
          { start_time: -1 },
          { start_time: 10, end_time: 9, title: "  Topic  " },
          { start_time: 10 },
          { start_time: 5 },
          { start_time: Infinity },
        ],
      }),
    ).toEqual([{ startTime: 10, title: "Topic" }]);
  });

  test("converts Whisper millisecond offsets and ignores malformed segments", () => {
    expect(
      parseWhisperSegments({
        transcription: [
          { offsets: { from: 1250, to: 2500 }, text: " Hello. " },
          { offsets: { from: -5, to: 1 }, text: "invalid" },
          { offsets: { from: 500, to: 1000 }, text: "out of order" },
          { offsets: { from: 2500, to: 3000 }, text: "Again." },
        ],
      }),
    ).toEqual([
      { startTime: 1.25, endTime: 2.5, text: "Hello." },
      { startTime: 2.5, endTime: 3, text: "Again." },
    ]);
    expect(parseWhisperSegments(null)).toEqual([]);
  });
});

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

  test("strips VTT header metadata lines like Kind and Language", () => {
    const vtt = `WEBVTT
Kind: captions
Language: en

00:00:00.320 --> 00:00:02.879
Flow matching is the newest paradigm.`;

    const result = stripVttTimestamps(vtt);
    expect(result).toBe("Flow matching is the newest paradigm.");
    expect(result).not.toContain("Kind:");
    expect(result).not.toContain("Language:");
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

  test("preserves non-adjacent repeated lines (e.g. song refrains)", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
Hello.

00:00:02.000 --> 00:00:04.000
Different line.

00:00:04.000 --> 00:00:06.000
Hello.`;

    const result = stripVttTimestamps(vtt);
    expect(result).toContain("Hello.");
    expect(result).toContain("Different line.");
    // The second "Hello." must NOT be dropped
    const helloCount = result.split("Hello.").length - 1;
    expect(helloCount).toBe(2);
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
    expect(result).toBe("This is the first part of a sentence.\n\nAnd this is another.");
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

  test("bounds source chapters to their next section and duration, filling missing ends", () => {
    expect(
      parseChapters({
        duration: 120,
        chapters: [
          { title: "  First\n section ", start_time: 0, end_time: 200 },
          { title: "Second", start_time: 60 },
          { title: "Outside video", start_time: 130, end_time: 200 },
        ],
      }),
    ).toEqual([
      { title: "First section", startTime: 0, endTime: 60 },
      { title: "Second", startTime: 60, endTime: 120 },
    ]);
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
