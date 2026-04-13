# extractor

`extractor` is curl for AI-ready content.

Give it a URL and it returns clean, structured content for humans, scripts, and coding agents.
It automatically detects web pages, PDFs, and YouTube videos, then converts them into AI-ready Markdown, text, or JSON.

```bash
extractor 'https://www.youtube.com/watch?v=3mFNpeJQjmw&t=1315s'
```

## Requirements

Base requirement:

- [Bun](https://bun.sh) to run the CLI

Capability requirements:

| Capability | Works by default | Requires |
|------------|------------------|----------|
| Web page extraction | Yes | Bun |
| PDF extraction | Yes | Bun |
| YouTube extraction | No | `yt-dlp` |
| Audio transcription fallback | No | `whisper.cpp` |
| AI summaries | No | `claude`, `codex`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` |

Check what your machine supports:

```bash
extractor doctor
extractor doctor --json
```

Set up a missing capability explicitly:

```bash
extractor setup youtube
extractor setup youtube --run
```

## Install

Requires [Bun](https://bun.sh).

```bash
bun install
```

Capability-specific dependencies are not auto-installed:

| Tool | Purpose | Install |
|------|---------|---------|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | YouTube metadata & captions | `brew install yt-dlp` |
| [whisper.cpp](https://github.com/ggerganov/whisper.cpp) | Audio transcription fallback | `brew install whisper-cpp` |
| [claude](https://docs.anthropic.com/en/docs/claude-code) | AI summaries | `npm install -g @anthropic-ai/claude-code` |
| [codex](https://github.com/openai/codex) | AI summaries | `npm install -g @openai/codex` |

Run `extractor doctor` to see what is installed and what is missing. Use `extractor setup <target>` for explicit setup guidance.

## CLI contract

By default, `extractor` behaves like curl for AI-ready content:

- input: a URL as an argument or on stdin
- output: AI-ready Markdown on stdout
- logs: progress and status on stderr
- AI: off by default, opt in with `--summarize`

### Core commands

```bash
extractor <url>
extractor --json <url>
extractor --text <url>
extractor --summarize <url>
extractor --output file.md <url>
extractor doctor
extractor doctor --json
extractor setup youtube
extractor setup youtube --run
```

### Examples

Extract a YouTube video as Markdown:

```bash
extractor 'https://www.youtube.com/watch?v=3mFNpeJQjmw&t=1315s'
```

Extract a web page as JSON:

```bash
extractor --json 'https://paulgraham.com/superlinear.html'
```

Add an AI summary:

```bash
extractor --summarize 'https://paulgraham.com/superlinear.html'
```

Write output to a file:

```bash
extractor --output video.md 'https://www.youtube.com/watch?v=3mFNpeJQjmw&t=1315s'
```

Check environment health:

```bash
extractor doctor
```

Get machine-readable health output for agents:

```bash
extractor doctor --json
```

Show how to enable YouTube extraction:

```bash
extractor setup youtube
```

Run the automatic setup plan when available:

```bash
extractor setup youtube --run
```

Pipe a URL on stdin:

```bash
printf '%s\n' 'https://example.com?a=1&b=2' | extractor
```

Save stdout yourself:

```bash
extractor 'https://paulgraham.com/superlinear.html' > article.md
```

## Options

```text
--json                   Output structured JSON
--text                   Output plain text
--summarize              Add an AI summary
--output <path>          Write result to a file instead of stdout
--lang <code>            Caption language for YouTube (default: en)
--provider <name>        AI provider for --summarize (claude|codex|none)
--format md|txt|json     Advanced format override
--run                    Execute an automatic setup plan
--check                  Alias for human-readable doctor output
--version                Show version
--help                   Show help
```

Compatibility aliases retained for older scripts:

```text
--raw                    Alias for default non-summarized output
--stdout                 Alias for default stdout output
```

## Doctor

`extractor doctor` reports the current state of the machine:

- installed tools
- configured API keys
- available capabilities
- recommended next actions

For agents and scripts, `extractor doctor --json` returns a structured JSON report that can be parsed programmatically.

## Setup

`extractor setup <target>` is explicit and safe by default.
It shows how to install a missing dependency without silently mutating the machine.

Supported targets:

- `youtube`
- `whisper`
- `claude`
- `codex`

If an automatic installer is available, `extractor setup <target> --run` executes it explicitly.

## JS API

For SDK usage, the main flow is:

- `extract(url, options?)`
- `inspect(url, options?)`
- typed `ExtractorError` failures

Use the same extraction engine directly from Bun or TypeScript:

```ts
import {
  extract,
  inspect,
  probeEnvironment,
  getSetupPlan,
  ExtractorError,
} from "extractor";

const inspection = await inspect(
  "https://www.youtube.com/watch?v=3mFNpeJQjmw&t=1315s",
);

if (!inspection.ready) {
  console.log(inspection.issues);
}

try {
  const result = await extract(
    "https://www.youtube.com/watch?v=3mFNpeJQjmw&t=1315s",
  );

  console.log(result.type);
  console.log(result.markdown);
  console.log(result.json);
} catch (error) {
  if (error instanceof ExtractorError) {
    console.log(error.code);
    console.log(error.issue.setupCommand);
  }
}

const environment = await probeEnvironment();
const setup = await getSetupPlan("youtube");
```

`extract(url, options?)` returns a small, agent-friendly object:

- `type`, `title`, `source`, `summary`
- `markdown` for AI-ready Markdown
- `text` for plain text
- `json` for structured data

`inspect(url, options?)` returns a preflight result:

- detected `type`
- `ready` boolean
- structured `issues`
- extraction and summary capability info

Options:

```ts
type ExtractOptions = {
  summarize?: boolean;
  lang?: string;
  provider?: "claude" | "codex" | "none";
  logger?: ExtractLogger;
};
```

By default, the SDK is quiet. If you want CLI-style progress output, pass a logger:

```ts
import { extract, createStderrLogger } from "extractor";

const result = await extract("https://example.com", {
  logger: createStderrLogger(),
});
```

`probeEnvironment()` is the SDK-friendly version of `doctor`, while `doctor --json` remains the best shell entrypoint for agents.

## Output model

`extractor` is designed to be easy for both developers and coding agents:

- `stdout` contains only the extracted content
- `stderr` contains progress, dependency hints, and errors
- exit code `0` means success
- non-zero exit codes mean extraction failed

## AI summaries

AI summaries are opt-in via `--summarize`.

Extractor looks for providers in this order:

1. `claude` CLI
2. `codex` CLI
3. `ANTHROPIC_API_KEY`
4. `OPENAI_API_KEY`

If you request `--summarize` and no provider is available, extractor exits with a helpful error.

## Development

```bash
bun run extractor 'https://example.com/article'
bun test
```

## License

MIT
