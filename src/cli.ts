import { parseArgs } from "util";
import {
  render,
  resolveUrlType,
  extract,
  download,
  convertAudio,
  type ExtractFormat,
  type ExtractProvider,
  type DownloadOptions,
} from "./api";
import { checkDependencies, getDoctorReport } from "./utils/deps";
import { createStderrLogger, log, logError, logSuccess } from "./utils/log";
import { writeOutput } from "./output/formatter";
import { isValidSource } from "./utils/url";
import {
  formatSetupPlans,
  getSetupPlans,
  getSetupTargetLabels,
  isSetupTarget,
  installTargets,
  EXTRACTION_TARGETS,
  getSetupTargets,
} from "./setup";
import { runFeedbackCommand } from "./feedback";
import { OutformError, unknownSetupTargetIssue, invalidOptionsIssue } from "./errors";
import type { SetupTarget } from "./utils/deps";
import packageJson from "../package.json" with { type: "json" };

const { version } = packageJson;

const HELP = `
outform - curl for AI-ready content

Give it a URL or file path. Get back clean content for humans, scripts, and coding agents.

Usage:
  outform <source> [options]
  outform download <url> [--format mp4|mp3|original] [--output <directory>] [--json|--text]
  outform audio <file> [--output <directory>] [--json|--text]
  outform [options]      Read a URL or file path from stdin
  outform doctor [--json]
  outform install [target ...] [--dry-run] [--json]
  outform feedback --message "<feedback>" [--json]
  outform --check
  outform --help

Default behavior:
  Prints AI-ready Markdown to stdout.
  Prints logs and progress to stderr.
  Includes video title, channel, description, thumbnail URL, upload date, chapters, and timed transcript.
  Generates missing chapters only when requested with --chapters.
  Quote URLs that contain shell characters like ? or &.

Options:
  --audio                  Shortcut for download --format mp3
  --json                   Output structured JSON
  --text                   Output plain text
  --chapters               Generate missing YouTube chapters with short descriptions
  --output <path>          Result file; with download, parent directory for media
  --lang <code>            Caption language for YouTube (default: en)
  --provider <name>        Chapter provider for --chapters (claude|codex|none)
  --format <format>        Extraction: md|txt|json; download: mp4|mp3|original
  --check                  Alias for human-readable doctor output
  --version                Show version
  --help                   Show this help

Commands:
  doctor                   Show dependency and capability status
  install                  Prepare extraction tools and model (no target needed)
  install all              Also install both AI CLIs (optional)
  feedback                 Send feedback or a failed-task report; see feedback --help
  download                 Save MP4 videos, MP3 audio and original images; see download --help
  audio                    Convert a local audio/video file to MP3 without downloading

Media downloads:
  Instagram, X/Twitter, TikTok, Pinterest, Facebook, Reddit, Vimeo, and YouTube post/video URLs.
  Spotify public podcast audio also works; no music or preview downloads.
  Saves media and metadata.json under ./outform-downloads, or --output <directory>.
  MP4/MP3 exports require ffmpeg/ffprobe; run outform install ffmpeg. Ctrl-C removes temporary files.
  Use --format original to preserve source formats, including tool-free Spotify originals.
  Each post gets its own folder. Restricted, removed, or rate-limited posts may be unavailable.

Setup prerequisites:
  macOS: Homebrew with a compatible Whisper bottle.
  Linux: glibc x64/arm64, tar, and OpenMP/C++ runtimes (libgomp1/libstdc++6 on Debian/Ubuntu).
  Linux x64 FFmpeg also needs glibc >= 2.28, kernel >= 4.18, and xz (xz-utils on Debian/Ubuntu).

Setup options:
  --dry-run                Show the setup plan without installing
  --json                   Return a machine-readable setup plan or result

Compatibility:
  --raw                    Alias for default source-only output
  --stdout                 Alias for default stdout output

Examples:
  outform 'https://www.youtube.com/watch?v=3mFNpeJQjmw&t=1315s'
  outform --json 'https://example.com/article'
  outform --chapters 'https://www.youtube.com/watch?v=3mFNpeJQjmw'
  outform ./report.pdf
  outform ./notes.md
  outform download 'https://www.instagram.com/reel/DfAZMAjseOQ/'
  outform download 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' --audio
  outform audio ./video.mp4
  outform doctor --json
  outform install
  outform install youtube
  printf '%s\\n' 'https://example.com?a=1&b=2' | outform
`.trim();

const DOWNLOAD_HELP = `
outform download <url> [options]

Save public media and metadata.json in a new folder under ./outform-downloads.

  --format mp4       MP4 video (H.264/AAC), MP3 audio, original images (default)
  --format mp3       Audio only; skip photos and save MP3
  --format original  Preserve source formats, including MKV/WebM
  --audio            Shortcut for --format mp3
  --output <dir>     Parent directory for saved files
  --json             Print the download report as JSON
  --text             Print the download report as plain text

Compatible MP4/MP3 files are preserved. Other media is repackaged or converted;
encoding can take time and slightly change quality. Original mode avoids encoding.
Silent videos remain silent. Audio-only export requires an audio track.
Use outform install youtube ffmpeg to prepare downloads without Whisper.
Spotify originals and image-only posts do not need FFmpeg.
Restricted, removed or rate-limited posts may be unavailable.
Ctrl-C cancels work and removes temporary files; completed files remain.

Examples:
  outform download 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
  outform download 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' --format mp3 --json
  outform download 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' --format original
`.trim();

const AUDIO_HELP = `
outform audio <file> [--output <directory>] [--json|--text]

Convert a saved audio or video file to MP3 without fetching its source again.
The input is preserved. Existing MP3 bytes are copied; other audio is encoded at 192 kbps.
The output is fully decoded and hashed before it is saved with metadata.json.
Run outform install ffmpeg first. Ctrl-C cancels and removes temporary files.

Example:
  outform audio ./video.mp4 --output ./audio --json
`.trim();

export interface CliOptions {
  url: string;
  chapters: boolean;
  format: ExtractFormat;
  lang: string;
  provider: ExtractProvider | undefined;
  output: string | undefined;
}

async function readUrlFromStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined;
  }

  let input = "";

  for await (const chunk of process.stdin) {
    input += chunk.toString();
  }

  const firstLine = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine || undefined;
}

function resolveFormat(values: Record<string, unknown>, mediaCommand = false): ExtractFormat {
  const json = values.json as boolean;
  const text = values.text as boolean;
  const selected = values.format as string | undefined;
  const format = mediaCommand && ["mp4", "mp3", "original"].includes(selected ?? "") ? "md" : (selected ?? "md");

  if (json && text) {
    throw new Error("Choose only one of --json or --text.");
  }

  if (!["md", "txt", "json"].includes(format)) {
    throw new Error(`Invalid format: ${format}. Use ${mediaCommand ? "mp4, mp3, or original" : "md, txt, or json"}.`);
  }

  if (json) return "json";
  if (text) return "txt";
  return format as ExtractFormat;
}

function resolveMediaFormat(values: Record<string, unknown>, converting: boolean): DownloadOptions["format"] {
  const selected = values.format;
  const format = selected === "mp4" || selected === "mp3" || selected === "original" ? selected : undefined;
  if ((values.audio || converting) && format && format !== "mp3")
    throw new Error("Audio export produces MP3. Use --format mp3, or omit --audio to keep the video.");
  return format ?? (values.audio || converting ? "mp3" : "mp4");
}

function resolveChapters(values: Record<string, unknown>): boolean {
  const raw = values.raw as boolean;
  const chaptersRequested = values.chapters as boolean;

  if (raw && chaptersRequested) {
    throw new Error("Use either --chapters or --raw, not both.");
  }

  return chaptersRequested;
}

function resolveProvider(values: Record<string, unknown>, chaptersRequested: boolean): ExtractProvider | undefined {
  const provider = values.provider as string | undefined;

  if (!provider) {
    return undefined;
  }

  if (!["claude", "codex", "none"].includes(provider)) {
    throw new Error(`Unknown provider "${provider}". Use: claude, codex, or none.`);
  }

  if (!chaptersRequested && provider !== "none") {
    throw new Error("Use --provider together with --chapters.");
  }

  return provider as ExtractProvider;
}

async function emitOutput(content: string, outputPath?: string): Promise<void> {
  if (!outputPath || outputPath === "-") {
    process.stdout.write(content);
    return;
  }

  await writeOutput(outputPath, content);
  logSuccess(`Saved to ${outputPath}`);
}

async function runDoctor(jsonOutput: boolean): Promise<void> {
  if (jsonOutput) {
    const report = await getDoctorReport();
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }

  await checkDependencies();
}

function cliError(error: unknown, jsonOutput: boolean, setup = false): void {
  const issue =
    error instanceof OutformError
      ? error.issue
      : invalidOptionsIssue(error instanceof Error ? error.message : String(error));
  if (jsonOutput)
    process.stdout.write(
      JSON.stringify({ ...(setup ? { ready: false, results: [] } : {}), issues: [issue] }, null, 2) + "\n",
    );
  logError(issue.message);
  process.exitCode = 1;
}

async function runSetupCommand(requested: string[], shouldRun: boolean, jsonOutput = false): Promise<void> {
  const targets: SetupTarget[] = [];
  if (requested.includes("all") && requested.length > 1)
    throw new OutformError(invalidOptionsIssue("Use install all on its own, or name individual targets."));
  if (!requested.length) targets.push(...EXTRACTION_TARGETS);
  else if (requested[0] === "all") targets.push(...getSetupTargets());
  else
    for (const target of requested) {
      if (!isSetupTarget(target)) throw new OutformError(unknownSetupTargetIssue(target, getSetupTargetLabels()));
      targets.push(target);
    }
  if (!shouldRun) {
    const plans = await getSetupPlans(targets);
    process.stdout.write((jsonOutput ? JSON.stringify({ plans }, null, 2) : formatSetupPlans(plans)) + "\n");
    return;
  }
  const report = await installTargets(targets);
  if (jsonOutput) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (!report.ready) process.exitCode = 1;
  else if (!requested.length) logSuccess("Extraction setup is ready. Chapter generation is optional.");
}

export async function run(args: string[]): Promise<void> {
  if (args[0] === "feedback") {
    try {
      await runFeedbackCommand(args.slice(1));
    } catch (error) {
      cliError(error, args.includes("--json"));
    }
    return;
  }
  if (args.includes("--summarize")) {
    cliError(
      new Error(
        "--summarize has been removed. Outform returns source content; use --chapters for missing YouTube chapters.",
      ),
      args.includes("--json"),
    );
    return;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        raw: { type: "boolean", default: false },
        stdout: { type: "boolean", default: false },
        chapters: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        audio: { type: "boolean", default: false },
        text: { type: "boolean", default: false },
        output: { type: "string" },
        format: { type: "string" },
        lang: { type: "string", default: "en" },
        provider: { type: "string" },
        run: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        check: { type: "boolean", default: false },
        version: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });
  } catch (error) {
    cliError(error, args.includes("--json"), args[0] === "install" || args[0] === "setup");
    return;
  }

  const { values, positionals } = parsed;
  const command = positionals[0];

  if (values.help) {
    process.stdout.write((command === "download" ? DOWNLOAD_HELP : command === "audio" ? AUDIO_HELP : HELP) + "\n");
    return;
  }

  if (values.version) {
    console.log(`outform v${version}`);
    return;
  }

  try {
    if (command === "doctor") {
      await runDoctor(values.json as boolean);
      return;
    }

    if (command === "setup") {
      await runSetupCommand(positionals.slice(1), Boolean(values.run) && !values["dry-run"], values.json);
      return;
    }

    if (command === "install") {
      await runSetupCommand(positionals.slice(1), !values["dry-run"], values.json);
      return;
    }

    if (values.check) {
      await runDoctor(false);
      return;
    }
  } catch (error) {
    cliError(error, args.includes("--json"), args[0] === "install" || args[0] === "setup");
    return;
  }

  const downloading = command === "download";
  const converting = command === "audio";
  if (values.audio && !downloading && !converting) {
    cliError(
      new Error("Use --audio with outform download, or outform audio <file> for local conversion."),
      values.json,
    );
    return;
  }
  if ((downloading || converting) && (values.chapters || values.provider || values.raw || positionals.length > 2)) {
    cliError(
      new Error(
        "Use outform download <url> [--output <directory>] [--json|--text]. Chapter and provider options apply to extraction only.",
      ),
      values.json,
    );
    return;
  }
  const url = positionals[downloading || converting ? 1 : 0] ?? (await readUrlFromStdin());
  if (!url) {
    cliError(
      new Error("No source provided. Pass a URL or file path, or pipe one on stdin. Run `outform --help` for usage."),
      values.json,
    );
    return;
  }

  if (!(await isValidSource(url))) {
    cliError(new Error(`Invalid URL or file path: ${url}`), values.json);
    return;
  }

  let format: ExtractFormat;
  let chaptersRequested: boolean;
  let provider: ExtractProvider | undefined;
  let mediaFormat: DownloadOptions["format"];

  try {
    format = resolveFormat(values, downloading || converting);
    if (downloading || converting) mediaFormat = resolveMediaFormat(values, converting);
    chaptersRequested = resolveChapters(values);
    provider = resolveProvider(values, chaptersRequested);
  } catch (error) {
    cliError(error, args.includes("--json"), args[0] === "install" || args[0] === "setup");
    return;
  }

  const options: CliOptions = {
    url,
    chapters: chaptersRequested,
    format,
    lang: values.lang as string,
    provider,
    output: values.output as string | undefined,
  };

  const controller = new AbortController();
  let interrupted = 0;
  const interrupt = () => {
    interrupted = 130;
    controller.abort();
  };
  const terminate = () => {
    interrupted = 143;
    controller.abort();
  };
  if (downloading || converting) {
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
  }
  try {
    if (downloading || converting) {
      const saveOptions = { directory: options.output, logger: createStderrLogger(), signal: controller.signal };
      const result = converting
        ? await convertAudio(url, saveOptions)
        : await download(url, { ...saveOptions, format: mediaFormat });
      await emitOutput(render(result, options.format));
      if (result.issues.length) {
        const saved = result.json.media.filter((asset) => asset.file).length;
        logError(
          `Download incomplete: ${saved} file(s) saved. See the issues in the result. Saved files and metadata: ${result.json.directory}`,
        );
        process.exitCode = 1;
      }
      return;
    }
    const urlType = await resolveUrlType(url);
    log(`Detected type: ${urlType}`);

    const result = await extract(url, {
      chapters: options.chapters,
      lang: options.lang,
      provider: options.provider,
      urlType,
      logger: createStderrLogger(),
    });

    await emitOutput(render(result, options.format), options.output);
  } catch (error) {
    cliError(error, args.includes("--json"), args[0] === "install" || args[0] === "setup");
    return;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    if (interrupted) process.exitCode = interrupted;
  }
}
