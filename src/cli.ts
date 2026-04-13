import { parseArgs } from "util";
import {
  render,
  resolveUrlType,
  extract,
  type ExtractFormat,
  type ExtractProvider,
} from "./api";
import {
  checkDependencies,
  getDoctorReport,
} from "./utils/deps";
import { createStderrLogger, log, logError, logSuccess } from "./utils/log";
import { writeOutput } from "./output/formatter";
import { isValidUrl } from "./utils/url";
import {
  formatSetupPlan,
  getSetupPlan,
  getSetupTargets,
  isSetupTarget,
  runSetup,
} from "./setup";
import { ExtractorError, unknownSetupTargetIssue } from "./errors";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const HELP = `
extractor - curl for AI-ready content

Give it a URL. Get back clean content for humans, scripts, and coding agents.

Usage:
  extractor <url> [options]
  extractor [options]      Read URL from stdin
  extractor doctor [--json]
  extractor setup <target> [--run]
  extractor --check
  extractor --help

Default behavior:
  Prints AI-ready Markdown to stdout.
  Prints logs and progress to stderr.
  Does not use AI unless you ask for it with --summarize.
  Quote URLs that contain shell characters like ? or &.

Options:
  --json                   Output structured JSON
  --text                   Output plain text
  --summarize              Add an AI summary
  --output <path>          Write result to a file instead of stdout
  --lang <code>            Caption language for YouTube (default: en)
  --provider <name>        AI provider for --summarize (claude|codex|none)
  --format <md|txt|json>   Advanced format override
  --run                    Execute an automatic setup plan
  --check                  Alias for human-readable doctor output
  --version                Show version
  --help                   Show this help

Commands:
  doctor                   Show dependency and capability status
  setup                    Show or run setup for youtube|whisper|claude|codex

Compatibility:
  --raw                    Alias for default non-summarized output
  --stdout                 Alias for default stdout output

Examples:
  extractor 'https://www.youtube.com/watch?v=3mFNpeJQjmw&t=1315s'
  extractor --json 'https://example.com/article'
  extractor --summarize 'https://example.com/article'
  extractor doctor --json
  extractor setup youtube
  extractor setup youtube --run
  printf '%s\n' 'https://example.com?a=1&b=2' | extractor
`.trim();

const SETUP_HELP = `
extractor setup <target> [--run]

Targets:
  ${getSetupTargets().join("\n  ")}

Examples:
  extractor setup youtube
  extractor setup youtube --run
`.trim();

export interface CliOptions {
  url: string;
  summarize: boolean;
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

function resolveSummarize(values: Record<string, unknown>): boolean {
  const raw = values.raw as boolean;
  const summarizeRequested = values.summarize as boolean;

  if (raw && summarizeRequested) {
    throw new Error("Use either --summarize or --raw, not both.");
  }

  return summarizeRequested;
}

function resolveProvider(
  values: Record<string, unknown>,
  summarizeRequested: boolean,
): ExtractProvider | undefined {
  const provider = values.provider as string | undefined;

  if (!provider) {
    return undefined;
  }

  if (!["claude", "codex", "none"].includes(provider)) {
    throw new Error(`Unknown provider "${provider}". Use: claude, codex, or none.`);
  }

  if (!summarizeRequested && provider !== "none") {
    throw new Error("Use --provider together with --summarize.");
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

async function runSetupCommand(target: string | undefined, shouldRun: boolean): Promise<void> {
  if (!target) {
    process.stdout.write(SETUP_HELP + "\n");
    return;
  }

  if (!isSetupTarget(target)) {
    throw new ExtractorError(
      unknownSetupTargetIssue(target, getSetupTargets()),
    );
  }

  if (shouldRun) {
    await runSetup(target);
    return;
  }

  const plan = await getSetupPlan(target);
  process.stdout.write(formatSetupPlan(plan) + "\n");
}

export async function run(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        raw: { type: "boolean", default: false },
        stdout: { type: "boolean", default: false },
        summarize: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        text: { type: "boolean", default: false },
        output: { type: "string" },
        format: { type: "string", default: "md" },
        lang: { type: "string", default: "en" },
        provider: { type: "string" },
        run: { type: "boolean", default: false },
        check: { type: "boolean", default: false },
        version: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });
  } catch (e: any) {
    logError(e.message);
    process.exit(1);
  }

  const { values, positionals } = parsed;
  const command = positionals[0];

  if (values.help) {
    console.log(HELP);
    return;
  }

  if (values.version) {
    console.log(`extractor v${version}`);
    return;
  }

  try {
    if (command === "doctor") {
      await runDoctor(values.json as boolean);
      return;
    }

    if (command === "setup") {
      await runSetupCommand(positionals[1], values.run as boolean);
      return;
    }

    if (values.check) {
      await runDoctor(false);
      return;
    }
  } catch (e: any) {
    logError(e.message);
    process.exit(1);
  }

  const url = positionals[0] ?? (await readUrlFromStdin());
  if (!url) {
    logError(
      "No URL provided. Pass a quoted URL, or pipe one on stdin. Run `extractor --help` for usage.",
    );
    process.exit(1);
  }

  if (!isValidUrl(url)) {
    logError(`Invalid URL: ${url}`);
    process.exit(1);
  }

  let format: ExtractFormat;
  let summarizeRequested: boolean;
  let provider: ExtractProvider | undefined;

  try {
    format = resolveFormat(values);
    summarizeRequested = resolveSummarize(values);
    provider = resolveProvider(values, summarizeRequested);
  } catch (e: any) {
    logError(e.message);
    process.exit(1);
  }

  const options: CliOptions = {
    url,
    summarize: summarizeRequested,
    format,
    lang: values.lang as string,
    provider,
    output: values.output as string | undefined,
  };

  try {
    const urlType = await resolveUrlType(url);
    log(`Detected type: ${urlType}`);

    const result = await extract(url, {
      summarize: options.summarize,
      lang: options.lang,
      provider: options.provider,
      urlType,
      logger: createStderrLogger(),
    });

    await emitOutput(render(result, options.format), options.output);
  } catch (e: any) {
    logError(e.message);
    process.exit(1);
  }
}
