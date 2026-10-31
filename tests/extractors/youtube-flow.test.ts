import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createManagedTools } from "../fixtures/tools";

const source = "https://www.youtube.com/watch?v=abc123def45";
const roots: string[] = [];
const metadata = {
  title: "Building a garden bench",
  channel: "Workshop",
  channel_id: "UCworkshop",
  channel_url: "https://www.youtube.com/channel/UCworkshop",
  thumbnail: "https://i.ytimg.com/vi/abc123def45/hqdefault.jpg",
  upload_date: "20261030",
  description: "A publisher description that should survive without any AI setup.",
  duration: 70,
  chapters: [
    { title: "Preparation", start_time: 0, end_time: 30 },
    { title: "Assembly", start_time: 30, end_time: 70 },
  ],
};
const captions = `WEBVTT

00:00:02.500 --> 00:00:08.000
<v Narrator>Gather wood &amp; screws.</v>

00:00:30.250 --> 00:00:42.000
Assemble the bench.
`;

const downloader = `#!/bin/sh
printf '%s\\n' "$*" >> "$OUTFORM_TEST_CALLS"
mode=''
output=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dump-json) mode='metadata' ;;
    --write-sub) mode='captions' ;;
    --extract-audio) mode='audio' ;;
    -o) shift; output="$1" ;;
  esac
  shift
done
case "$mode" in
  metadata) /bin/cat "$OUTFORM_TEST_METADATA" ;;
  captions)
    if [ -n "$OUTFORM_TEST_CAPTIONS" ]; then
      /bin/cp "$OUTFORM_TEST_CAPTIONS" "$(/usr/bin/dirname "$output")/captions.en.vtt"
    fi ;;
  audio) printf 'fake wav' > "$(/usr/bin/dirname "$output")/audio.wav" ;;
esac
`;

const transcriber = `#!/bin/sh
if [ "$1" = '--help' ]; then
  printf 'usage: whisper-cli --model --file --output-json --output-file\\n'
  exit 0
fi
printf '%s\\n' "$*" >> "$OUTFORM_TEST_WHISPER_CALLS"
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--output-file' ]; then
    shift
    /bin/cp "$OUTFORM_TEST_WHISPER_JSON" "$1.json"
    exit 0
  fi
  shift
done
exit 1
`;

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(
  options: { sourceChapters?: boolean; captions?: boolean; whisper?: boolean; providerTrap?: boolean } = {},
) {
  const tools = await createManagedTools(
    options.whisper ? ["yt-dlp", "deno", "ffmpeg", "ffprobe", "whisper-cli"] : ["yt-dlp", "deno"],
    { "yt-dlp": downloader, "whisper-cli": transcriber },
  );
  roots.push(tools.root);
  const metadataPath = join(tools.root, "metadata.json");
  const captionsPath = join(tools.root, "source.vtt");
  const whisperPath = join(tools.root, "whisper.json");
  const preload = join(tools.root, "offline.ts");
  const path = join(tools.root, "providers");
  await mkdir(path);
  await writeFile(
    metadataPath,
    JSON.stringify({ ...metadata, chapters: options.sourceChapters === false ? null : metadata.chapters }),
  );
  await writeFile(captionsPath, captions);
  await writeFile(
    whisperPath,
    JSON.stringify({
      transcription: [
        { offsets: { from: 1500, to: 12500 }, text: " Gather the tools. " },
        { offsets: { from: 30000, to: 45500 }, text: "Assemble the bench." },
      ],
    }),
  );
  await writeFile(
    preload,
    'globalThis.fetch = async () => { throw new Error("Network is forbidden in YouTube flow tests"); };',
  );
  if (options.providerTrap) {
    await writeFile(join(path, "claude"), '#!/bin/sh\nprintf called > "$OUTFORM_TEST_PROVIDER_CALLED"\nexit 1\n', {
      mode: 0o755,
    });
  }
  return {
    ...tools,
    preload,
    env: {
      ...process.env,
      ...tools.env,
      PATH: path,
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      OUTFORM_TEST_METADATA: metadataPath,
      OUTFORM_TEST_CAPTIONS: options.captions === false ? "" : captionsPath,
      OUTFORM_TEST_WHISPER_JSON: whisperPath,
      OUTFORM_TEST_CALLS: join(tools.root, "calls.log"),
      OUTFORM_TEST_WHISPER_CALLS: join(tools.root, "whisper-calls.log"),
      OUTFORM_TEST_PROVIDER_CALLED: join(tools.root, "provider-called"),
    },
  };
}

async function run(tools: Awaited<ReturnType<typeof fixture>>, chapters = false, cli = false) {
  const args = cli
    ? ["--preload", tools.preload, "src/bin.ts", "--json", ...(chapters ? ["--chapters"] : []), source]
    : [
        "--preload",
        tools.preload,
        "-e",
        `import { extract } from ${JSON.stringify(resolve("src/api.ts"))}; process.stdout.write(JSON.stringify(await extract(${JSON.stringify(source)}, { chapters: ${chapters} })));`,
      ];
  const child = Bun.spawn([process.execPath, ...args], { env: tools.env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode, stderr).toBe(0);
  const output = JSON.parse(stdout);
  return { data: cli ? output : output.json, result: cli ? undefined : output, stderr };
}

describe("YouTube extraction with owned tool fixtures", () => {
  test.each([{ chapters: false }, { chapters: true }])(
    "source chapters survive CLI extraction with chapters=$chapters without invoking a provider",
    async ({ chapters }) => {
      const tools = await fixture({ providerTrap: true });
      const { data } = await run(tools, chapters, true);
      expect(data.title).toBe(metadata.title);
      expect(data.description).toBe(metadata.description);
      expect(data.videoId).toBe("abc123def45");
      expect(data.author).toBe("Workshop");
      expect(data.channelId).toBe(metadata.channel_id);
      expect(data.channelUrl).toBe(metadata.channel_url);
      expect(data.thumbnail).toBe(metadata.thumbnail);
      expect(data.uploadDate).toBe("2026-10-30");
      expect(data.chaptersSource).toBe("source");
      expect(data.chapters).toEqual([
        { title: "Preparation", startTime: 0, endTime: 30 },
        { title: "Assembly", startTime: 30, endTime: 70 },
      ]);
      expect(data.issues).toEqual([]);
      expect(await Bun.file(tools.env.OUTFORM_TEST_PROVIDER_CALLED).exists()).toBe(false);
    },
  );

  test("caption timestamps and clean text reach API JSON and human-readable output", async () => {
    const tools = await fixture();
    const { data, result } = await run(tools);
    expect(data.transcriptSource).toBe("captions");
    expect(data.transcriptSegments).toEqual([
      { startTime: 2.5, endTime: 8, text: "Gather wood & screws." },
      { startTime: 30.25, endTime: 42, text: "Assemble the bench." },
    ]);
    expect(data.transcript).toBe("Gather wood & screws.\n\nAssemble the bench.");
    expect(result.markdown).toContain("[0:02] Gather wood & screws.");
    expect(result.markdown).toContain("[0:30] Assemble the bench.");
    expect(result.issues).toEqual([]);
    const calls = await readFile(tools.env.OUTFORM_TEST_CALLS, "utf8");
    expect(calls).toContain("--ignore-config --no-playlist --no-js-runtimes --js-runtimes deno:");
    expect(calls).not.toContain("--extract-audio");
  });

  test("requested chapters without a provider keep the transcript and report a structured issue", async () => {
    const tools = await fixture({ sourceChapters: false });
    const { data, result } = await run(tools, true);
    expect(data.transcript).toContain("Assemble the bench.");
    expect(data.transcriptSegments).toHaveLength(2);
    expect(data.chapters).toBeNull();
    expect(data.chaptersSource).toBeNull();
    expect(data.issues).toEqual([
      expect.objectContaining({ code: "CHAPTER_GENERATION_FAILED", capability: "aiChapters", url: source }),
    ]);
    expect(result.issues).toEqual(data.issues);
    expect(result.markdown).toContain("Gather wood & screws.");
  });

  test("missing captions and unavailable Whisper preserve metadata and publisher chapters", async () => {
    const tools = await fixture({ captions: false });
    const { data, result } = await run(tools);
    expect(data.title).toBe(metadata.title);
    expect(data.description).toBe(metadata.description);
    expect(data.chaptersSource).toBe("source");
    expect(data.chapters).toHaveLength(2);
    expect(data.transcript).toBe("");
    expect(data.transcriptSource).toBeNull();
    expect(data.transcriptSegments).toEqual([]);
    expect(data.issues).toEqual([
      expect.objectContaining({
        code: "TRANSCRIPT_UNAVAILABLE",
        capability: "transcription",
        setupCommand: "outform install whisper",
      }),
    ]);
    expect(result.markdown).toContain("Transcript unavailable.");
    expect(result.issues).toEqual(data.issues);
  });

  test("Whisper JSON fallback supplies timing and provenance after missing captions", async () => {
    const tools = await fixture({ captions: false, whisper: true });
    const { data } = await run(tools);
    expect(data.transcriptSource).toBe("whisper");
    expect(data.transcriptSegments).toEqual([
      { startTime: 1.5, endTime: 12.5, text: "Gather the tools." },
      { startTime: 30, endTime: 45.5, text: "Assemble the bench." },
    ]);
    expect(data.transcript).toBe("Gather the tools.\n\nAssemble the bench.");
    expect(data.issues).toEqual([]);
    const calls = await readFile(tools.env.OUTFORM_TEST_CALLS, "utf8");
    expect(calls).toContain("--extract-audio --audio-format wav");
    expect(calls).toContain("--ffmpeg-location");
    const whisperCalls = await readFile(tools.env.OUTFORM_TEST_WHISPER_CALLS, "utf8");
    expect(whisperCalls).toContain(`-m ${tools.env.WHISPER_MODEL}`);
    expect(whisperCalls).toContain("--output-json --output-file");
  });
});
