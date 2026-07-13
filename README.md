# outform

`outform` is curl for AI-ready content.

Give it a URL or local file path and it returns clean Markdown, text, or JSON for humans, scripts, and coding agents. It detects web pages, PDFs, text, Markdown, and YouTube videos automatically.

## Installation

### Global Installation

Install the CLI:

```bash
npm install -g outform
outform install
```

`outform install` installs the optional tools used for richer extraction, including YouTube captions, audio transcription fallback, and AI summaries when an automatic installer is available.

### Project Installation

For projects that want to pin the version in `package.json`:

```bash
npm install outform
npx outform install
```

Then use it from package scripts, `npx outform`, or the JS API.

### Standalone Binary

Each GitHub release includes a single-file executable for macOS, Linux, and Windows. It contains the Bun runtime plus built-in web, local-file, and PDF extraction, so Bun and Node.js are not needed on the target machine.

### Requirements

- Node.js 20.16+ or 22.3+ when installing from npm. The standalone binary does not require Node.js.
- Web page extraction and PDF extraction work from the npm package alone.
- YouTube extraction needs `yt-dlp`.
- Audio transcription fallback needs `whisper.cpp`.
- AI summaries need `claude`, `codex`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`.

Check the current machine at any time:

```bash
outform doctor
```

## Quick Start

Extract a web page as Markdown:

```bash
outform 'https://paulgraham.com/superlinear.html'
```

Extract a local PDF, HTML, Markdown, or text file:

```bash
outform ./report.pdf
outform ./notes.md
```

Extract a YouTube video:

```bash
outform 'https://www.youtube.com/watch?v=3mFNpeJQjmw&t=1315s'
```

Write the result to a file:

```bash
outform --output video.md 'https://www.youtube.com/watch?v=3mFNpeJQjmw&t=1315s'
```

Return structured JSON:

```bash
outform --json 'https://paulgraham.com/superlinear.html'
```

Return plain text:

```bash
outform --text 'https://paulgraham.com/superlinear.html'
```

Add an AI summary:

```bash
outform --summarize 'https://paulgraham.com/superlinear.html'
```

Pipe a URL on stdin:

```bash
printf '%s\n' 'https://example.com?a=1&b=2' | outform
```

## Commands

```bash
outform <source>                  # Extract AI-ready Markdown
outform --json <source>           # Extract structured JSON
outform --text <source>           # Extract plain text
outform --summarize <source>      # Add an AI summary
outform --output file.md <source> # Write output to a file
outform doctor                # Check installed tools and capabilities
outform doctor --json         # Machine-readable environment report
outform install               # Install every supported optional tool
```

Advanced targeted installs are also available:

```bash
outform install youtube
outform install whisper
outform install claude
outform install codex
```

If automatic installation is not available on your machine, `outform install` prints the manual command to run.

## Options

```text
--json                   Output structured JSON
--text                   Output plain text
--summarize              Add an AI summary
--output <path>          Write result to a file instead of stdout
--lang <code>            Caption language for YouTube (default: en)
--provider <name>        AI provider for --summarize (claude|codex|none)
--format <md|txt|json>   Advanced format override
--check                  Alias for human-readable doctor output
--version                Show version
--help                   Show help
```

Compatibility aliases retained for older scripts:

```text
--raw                    Alias for default non-summarized output
--stdout                 Alias for default stdout output
```

## Output Contract

By default, `outform` behaves like curl for content:

- input: a URL or file path as an argument or on stdin
- output: AI-ready Markdown on stdout
- logs: progress and status on stderr
- AI: off by default; opt in with `--summarize`

That means it composes cleanly with shell tools:

```bash
outform 'https://paulgraham.com/superlinear.html' > article.md
outform --json 'https://example.com/article' | jq .
```

## Doctor

`outform doctor` reports:

- installed tools
- configured API keys
- available capabilities
- recommended next actions

For agents and scripts, use JSON:

```bash
outform doctor --json
```

## Coding Agents

outform is built to be driven by agents: stdout carries content only, logs go to stderr, `doctor --json` reports capabilities, and failures exit non-zero with actionable messages.

The repo ships an [agent skill](skills/outform/SKILL.md) that teaches agents when and how to use the CLI. Install it with the [skills CLI](https://skills.sh):

```bash
npx skills add zvadaadam/extractor
```

Or copy it manually into your agent's skills directory, e.g. for Claude Code:

```bash
cp -r node_modules/outform/skills/outform .claude/skills/outform
```

## JS API

Use the same extraction engine directly from Node.js or TypeScript:

```ts
import { OutformError, extract, getInstallPlan, inspect, probeEnvironment, render } from "outform";

const source = "https://www.youtube.com/watch?v=3mFNpeJQjmw&t=1315s";

const inspection = await inspect(source);
if (!inspection.ready) {
  console.log(inspection.issues);
}

try {
  const result = await extract(source);

  console.log(result.type);
  console.log(result.markdown);
  console.log(render(result, "json"));
} catch (error) {
  if (error instanceof OutformError) {
    console.log(error.code);
    console.log(error.issue.setupCommand);
  }
}

const environment = await probeEnvironment();
const installPlan = await getInstallPlan("youtube");
```

`extract(source, options?)` returns an agent-friendly object:

- `type`, `title`, `source`, `summary`
- `markdown` for AI-ready Markdown
- `text` for plain text
- `json` for structured data

`inspect(source, options?)` returns a preflight result:

- detected `type`
- `ready` boolean
- structured `issues`
- extraction and summary capability info

## Troubleshooting

If YouTube extraction fails, run:

```bash
outform doctor
outform install
```

If you only want the YouTube dependency:

```bash
outform install youtube
```

If summaries do not run, either install a supported CLI:

```bash
outform install codex
```

or set an API key:

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-...
```

## Development

```bash
bun install
bun run src/bin.ts 'https://example.com/article'
bun test
npm run build
bun run build:binary
```

## License

MIT
