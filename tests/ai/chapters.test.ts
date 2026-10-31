import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { generateChapters } from "../../src/ai/chapters";
import type { Provider } from "../../src/ai/provider";
import type { TranscriptSegment } from "../../src/utils/vtt";

const segments: TranscriptSegment[] = [
  { startTime: 2.5, endTime: 10, text: "We start with preparation and the tools needed." },
  { startTime: 10, endTime: 45, text: "Choose your tools and prepare the workspace." },
  { startTime: 45, endTime: 60, text: "Now connect the pieces and check the fit." },
  { startTime: 60, endTime: 80, text: "Finally test the assembled result." },
];
const generated = {
  chapters: [
    { startSegment: 0, title: "Preparation", description: "The speaker explains the tools and workspace preparation." },
    { startSegment: 2, title: "Assembly", description: "The speaker connects the pieces and tests the result." },
  ],
};
const openai: Provider = { type: "openai-api", name: "OpenAI API" };
const anthropic: Provider = { type: "anthropic-api", name: "Anthropic API" };
const originalEnv = { ...process.env };
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
let directory: string | undefined;

afterEach(async () => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "PATH", "OUTFORM_TEST_STDIN"]) {
    const original = originalEnv[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

function mockOpenAi(content: unknown = generated, finishReason = "stop") {
  process.env.OPENAI_API_KEY = "test-key";
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      choices: [
        {
          finish_reason: finishReason,
          message: { content: typeof content === "string" ? content : JSON.stringify(content) },
        },
      ],
    }),
  );
  return fetchSpy;
}

describe("generateChapters", () => {
  test("grounds boundaries in the transcript and leaves source segments unchanged", async () => {
    const snapshot = structuredClone(segments);
    const request = mockOpenAi();
    expect(await generateChapters(segments, 90, openai)).toEqual([
      { title: "Preparation", description: generated.chapters[0]!.description, startTime: 0, endTime: 45 },
      { title: "Assembly", description: generated.chapters[1]!.description, startTime: 45, endTime: 90 },
    ]);
    expect(segments).toEqual(snapshot);
    const [, init] = request.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body.messages[0].role).toBe("system");
    expect(JSON.parse(body.messages[1].content)).toEqual(
      segments.map((segment, index) => ({
        index,
        startTime: segment.startTime,
        endTime: segment.endTime,
        text: segment.text,
      })),
    );
    expect(body.response_format.type).toBe("json_schema");
  });

  test("uses the final transcript end when video duration is unknown", async () => {
    mockOpenAi();
    const chapters = await generateChapters(segments, null, openai);
    expect(chapters.at(-1)?.endTime).toBe(80);
  });

  test("accepts a single chapter for a short single-topic video", async () => {
    mockOpenAi({ chapters: [generated.chapters[0]] });
    expect(await generateChapters(segments, null, openai)).toEqual([
      { title: "Preparation", description: generated.chapters[0]!.description, startTime: 0, endTime: 80 },
    ]);
  });

  test.each([
    { name: "nonexistent boundary", chapters: [{ ...generated.chapters[0], startSegment: 9 }] },
    { name: "missing beginning", chapters: [{ ...generated.chapters[0], startSegment: 1 }] },
    { name: "fractional boundary", chapters: [generated.chapters[0], { ...generated.chapters[1], startSegment: 1.5 }] },
    { name: "duplicate boundary", chapters: [generated.chapters[0], { ...generated.chapters[1], startSegment: 0 }] },
    {
      name: "reversed boundaries",
      chapters: [
        generated.chapters[0],
        { ...generated.chapters[1], startSegment: 3 },
        { ...generated.chapters[1], startSegment: 2 },
      ],
    },
    { name: "blank title", chapters: [{ ...generated.chapters[0], title: " " }] },
    { name: "missing description", chapters: [{ startSegment: 0, title: "Topic" }] },
    { name: "long description", chapters: [{ ...generated.chapters[0], description: "x".repeat(281) }] },
    { name: "empty chapters", chapters: [] },
  ])("rejects $name", async ({ chapters }) => {
    mockOpenAi({ chapters });
    await expect(generateChapters(segments, 90, openai)).rejects.toThrow();
  });

  test("rejects distinct segment indexes that produce identical chapter timestamps", async () => {
    mockOpenAi({ chapters: [generated.chapters[0], { ...generated.chapters[1], startSegment: 1 }] });
    const overlapping = [
      { ...segments[0]!, startTime: 0 },
      { ...segments[1]!, startTime: 0 },
    ];
    await expect(generateChapters(overlapping, 90, openai)).rejects.toThrow("increasing timestamps");
  });

  test("rejects invalid JSON and truncated responses", async () => {
    mockOpenAi("not json");
    await expect(generateChapters(segments, 90, openai)).rejects.toThrow("invalid JSON");
    fetchSpy?.mockRestore();
    mockOpenAi(generated, "length");
    await expect(generateChapters(segments, 90, openai)).rejects.toThrow("truncated");
  });

  test("rejects oversized input before making a provider request", async () => {
    const request = mockOpenAi();
    await expect(
      generateChapters([{ startTime: 0, endTime: 1, text: "x".repeat(120_001) }], 1, openai),
    ).rejects.toThrow("no partial chapters");
    expect(request).not.toHaveBeenCalled();
  });

  test("rejects missing provider and invalid transcript data before making a request", async () => {
    const request = mockOpenAi();
    await expect(generateChapters(segments, 90, { type: "none", name: "none" })).rejects.toThrow(
      "needs an AI provider",
    );
    await expect(generateChapters([], 90, openai)).rejects.toThrow("timestamped transcript");
    await expect(generateChapters([...segments].reverse(), 90, openai)).rejects.toThrow("ordered transcript");
    await expect(generateChapters([{ startTime: 0, endTime: NaN, text: "Hello" }], 90, openai)).rejects.toThrow(
      "valid timestamps",
    );
    await expect(generateChapters(segments, 30, openai)).rejects.toThrow("beyond the video duration");
    expect(request).not.toHaveBeenCalled();
  });

  test("surfaces provider refusal and HTTP errors", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ choices: [{ message: { refusal: "no" } }] }),
    );
    await expect(generateChapters(segments, 90, openai)).rejects.toThrow("declined");
    fetchSpy.mockResolvedValue(new Response("private upstream error details", { status: 401 }));
    await expect(generateChapters(segments, 90, openai)).rejects.toThrow("HTTP 401");
  });

  test("handles Anthropic text blocks and does not accept partial responses", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        stop_reason: "end_turn",
        content: [
          { type: "thinking", thinking: "internal text" },
          { type: "text", text: JSON.stringify(generated) },
        ],
      }),
    );
    const chapters = await generateChapters(segments, 90, anthropic);
    expect(chapters[1]?.startTime).toBe(45);
    fetchSpy.mockResolvedValue(
      Response.json({ stop_reason: "max_tokens", content: [{ type: "text", text: JSON.stringify(generated) }] }),
    );
    await expect(generateChapters(segments, 90, anthropic)).rejects.toThrow("truncated");
  });

  test("uses stdin for Claude CLI input and validates its response", async () => {
    directory = await mkdtemp(join(tmpdir(), "outform-chapter-test-"));
    const executable = join(directory, "claude");
    const capturedInput = join(directory, "input.json");
    await writeFile(executable, `#!/bin/sh\ncat > "$OUTFORM_TEST_STDIN"\nprintf '%s' '${JSON.stringify(generated)}'\n`);
    await chmod(executable, 0o755);
    process.env.PATH = [directory, "/usr/bin", "/bin"].join(delimiter);
    process.env.OUTFORM_TEST_STDIN = capturedInput;
    const chapters = await generateChapters(segments, 90, { type: "claude-cli", name: "Claude CLI" });
    expect(chapters[1]?.startTime).toBe(45);
    expect(JSON.parse(await readFile(capturedInput, "utf8"))).toHaveLength(segments.length);
  });

  test("reads Codex's last response file instead of progress output", async () => {
    directory = await mkdtemp(join(tmpdir(), "outform-chapter-test-"));
    const executable = join(directory, "codex");
    await writeFile(
      executable,
      `#!/bin/sh
cat > /dev/null
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    printf '%s' '${JSON.stringify(generated)}' > "$1"
    break
  fi
  shift
done
printf 'Progress output is not chapter JSON.'
`,
    );
    await chmod(executable, 0o755);
    process.env.PATH = [directory, "/usr/bin", "/bin"].join(delimiter);
    const chapters = await generateChapters(segments, 90, { type: "codex-cli", name: "Codex CLI" });
    expect(chapters[1]?.startTime).toBe(45);
  });

  test("surfaces CLI failures instead of treating stdout as successful chapters", async () => {
    directory = await mkdtemp(join(tmpdir(), "outform-chapter-test-"));
    const executable = join(directory, "claude");
    await writeFile(
      executable,
      `#!/bin/sh\ncat > /dev/null\nprintf '%s' '${JSON.stringify(generated)}'\nprintf 'Sign in required' >&2\nexit 1\n`,
    );
    await chmod(executable, 0o755);
    process.env.PATH = [directory, "/usr/bin", "/bin"].join(delimiter);
    await expect(generateChapters(segments, 90, { type: "claude-cli", name: "Claude CLI" })).rejects.toThrow(
      "Sign in required",
    );
  });
});
