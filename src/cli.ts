import { parseArgs } from "util";
import { detectUrlType, isValidUrl } from "./utils/url";
import { checkDependencies } from "./utils/deps";
import { log, logError, logSuccess } from "./utils/log";
import { extractWeb } from "./extractors/web";
import {
  formatWebMarkdown,
  formatWebText,
  formatWebJson,
  getWebOutputPath,
  writeOutput,
} from "./output/formatter";
import { version } from "../package.json";

const HELP = `
extractor - Extract clean, AI-ready markdown from URLs

Usage:
  extractor <url>          Extract content from a URL
  extractor --check        Check installed dependencies
  extractor --help         Show this help message

Arguments:
  url                      YouTube video, web page, or PDF URL

Options:
  --raw                    Skip AI summarization, output raw text
  --stdout                 Print content to stdout instead of file path
  --format <md|txt|json>   Output format (default: md)
  --lang <code>            Caption language for YouTube (default: en)
  --provider <name>        Force AI provider (claude|codex|none)
  --check                  Verify installed dependencies
  --version                Show version
  --help                   Show this help

Output:
  By default, writes to /tmp/extractor/ and prints the file path to stdout.
  All progress and status messages go to stderr.

Examples:
  extractor https://youtube.com/watch?v=dQw4w9WgXcQ
  extractor https://paulgraham.com/superlinear.html
  extractor https://arxiv.org/pdf/2301.00001.pdf
  extractor --raw --stdout https://example.com
  FILE=$(extractor https://example.com)
`.trim();

export interface CliOptions {
  url: string;
  raw: boolean;
  stdout: boolean;
  format: "md" | "txt" | "json";
  lang: string;
  provider: string | undefined;
}

export async function run(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        raw: { type: "boolean", default: false },
        stdout: { type: "boolean", default: false },
        format: { type: "string", default: "md" },
        lang: { type: "string", default: "en" },
        provider: { type: "string" },
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

  if (values.help) {
    console.log(HELP);
    return;
  }

  if (values.version) {
    console.log(`extractor v${version}`);
    return;
  }

  if (values.check) {
    await checkDependencies();
    return;
  }

  const url = positionals[0];
  if (!url) {
    logError("No URL provided. Run `extractor --help` for usage.");
    process.exit(1);
  }

  if (!isValidUrl(url)) {
    logError(`Invalid URL: ${url}`);
    process.exit(1);
  }

  const format = values.format as "md" | "txt" | "json";
  if (!["md", "txt", "json"].includes(format)) {
    logError(`Invalid format: ${format}. Use md, txt, or json.`);
    process.exit(1);
  }

  const options: CliOptions = {
    url,
    raw: values.raw as boolean,
    stdout: values.stdout as boolean,
    format,
    lang: values.lang as string,
    provider: values.provider as string | undefined,
  };

  const urlType = detectUrlType(url);
  log(`Detected type: ${urlType}`);

  try {
    switch (urlType) {
      case "web": {
        const result = await extractWeb(url);

        let formatted: string;
        switch (options.format) {
          case "txt":
            formatted = formatWebText(result);
            break;
          case "json":
            formatted = formatWebJson(result);
            break;
          default:
            formatted = formatWebMarkdown(result);
        }

        if (options.stdout) {
          process.stdout.write(formatted);
        } else {
          const outputPath = getWebOutputPath(url);
          await writeOutput(outputPath, formatted);
          logSuccess(`Saved to ${outputPath}`);
          process.stdout.write(outputPath + "\n");
        }
        break;
      }
      case "youtube":
        logError("YouTube extractor not yet implemented.");
        process.exit(1);
        break;
      case "pdf":
        logError("PDF extractor not yet implemented.");
        process.exit(1);
        break;
    }
  } catch (e: any) {
    logError(e.message);
    process.exit(1);
  }
}
