import { parseArgs } from "util";
import { render, resolveUrlType, extract, download, type ExtractFormat, type ExtractProvider } from "./api";
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
  outform download <url> [--output <directory>] [--json|--text]
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
  --json                   Output structured JSON
  --text                   Output plain text
  --chapters               Generate missing YouTube chapters with short descriptions
  --output <path>          Result file; with download, parent directory for media
  --lang <code>            Caption language for YouTube (default: en)
  --provider <name>        Chapter provider for --chapters (claude|codex|none)
  --format <md|txt|json>   Advanced format override
  --check                  Alias for human-readable doctor output
  --version                Show version
  --help                   Show this help

Commands:
  doctor                   Show dependency and capability status
  install                  Prepare extraction tools and model (no target needed)
  install all              Also install both AI CLIs (optional)
  feedback                 Send feedback or a failed-task report; see feedback --help
  download                 Save public videos, images, podcast audio, and carousel items (no account connection)

Media downloads:
  Instagram, X/Twitter, TikTok, Pinterest, Facebook, Reddit, Vimeo, and YouTube post/video URLs.
  Spotify public podcast originals also work, without installed tools; no music or preview downloads.
  Saves media and metadata.json under ./outform-downloads, or --output <directory>.
  Each post gets its own folder. Restricted, removed, or rate-limited posts may be unavailable.

Setup prerequisites:
  macOS: Homebrew with a compatible Whisper bottle.
  Linux: glibc x64/arm64, tar, and OpenMP/C++ runtimes (libgomp1/libstdc++6 on Debian/Ubuntu).

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
  outform doctor --json
  outform install
  outform install youtube
  printf '%s\\n' 'https://example.com?a=1&b=2' | outform
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

function resolveFormat(values: Record<string, unknown>): ExtractFormat {
  const json = values.json as boolean;
  const text = values.text as boolean;
  const format = values.format as string;

  if (json && text) {
    throw new Error("Choose only one of --json or --text.");
  }

  if (json) return "json";
  if (text) return "txt";

  if (!["md", "txt", "json"].includes(format)) {
    throw new Error(`Invalid format: ${format}. Use md, txt, or json.`);
  }

  return format as ExtractFormat;
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
        text: { type: "boolean", default: false },
        output: { type: "string" },
        format: { type: "string", default: "md" },
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
    console.log(HELP);
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
  if (downloading && (values.chapters || values.provider || values.raw || positionals.length > 2)) {
    cliError(
      new Error(
        "Use outform download <url> [--output <directory>] [--json|--text]. Chapter and provider options apply to extraction only.",
      ),
      values.json,
    );
    return;
  }
  const url = positionals[downloading ? 1 : 0] ?? (await readUrlFromStdin());
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

  try {
    format = resolveFormat(values);
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

  try {
    if (downloading) {
      const result = await download(url, { directory: options.output, logger: createStderrLogger() });
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
  }
}
