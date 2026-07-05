# extractor

`extractor` is curl for AI-ready content.

Give it a URL and it returns clean Markdown, text, or JSON for humans, scripts, and coding agents. It detects web pages, PDFs, and YouTube videos automatically.

## Installation

### Global Installation

Install the CLI:

```bash
npm install -g @zvadaadam/extractor
extractor install
```

`extractor install` installs the optional tools used for richer extraction, including YouTube captions, audio transcription fallback, and AI summaries when an automatic installer is available.

### Project Installation

For projects that want to pin the version in `package.json`:

```bash
npm install @zvadaadam/extractor
npx extractor install
```

Then use it from package scripts, `npx extractor`, or the JS API.

### Requirements

- Node.js 18+
- Web page extraction and PDF extraction work from the npm package alone.
- YouTube extraction needs `yt-dlp`.
- Audio transcription fallback needs `whisper.cpp`.
- AI summaries need `claude`, `codex`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`.

Check the current machine at any time:

```bash
extractor doctor
```

## Quick Start

Extract a web page as Markdown:

```bash
extractor 'https://paulgraham.com/superlinear.html'
```

Extract a YouTube video:

```bash
extractor 'https://www.youtube.com/watch?v=3mFNpeJQjmw&t=1315s'
```

Write the result to a file:

```bash
extractor --output video.md 'https://www.youtube.com/watch?v=3mFNpeJQjmw&t=1315s'
```

Return structured JSON:

```bash
extractor --json 'https://paulgraham.com/superlinear.html'
```

Return plain text:

```bash
extractor --text 'https://paulgraham.com/superlinear.html'
```

Add an AI summary:

```bash
extractor --summarize 'https://paulgraham.com/superlinear.html'
```

Pipe a URL on stdin:

```bash
printf '%s\n' 'https://example.com?a=1&b=2' | extractor
```

## Commands

```bash
extractor <url>                 # Extract AI-ready Markdown
extractor --json <url>          # Extract structured JSON
extractor --text <url>          # Extract plain text
extractor --summarize <url>     # Add an AI summary
extractor --output file.md <url> # Write output to a file
extractor doctor                # Check installed tools and capabilities
extractor doctor --json         # Machine-readable environment report
extractor install               # Install every supported optional tool
```

Advanced targeted installs are also available:

```bash
extractor install youtube
extractor install whisper
extractor install claude
extractor install codex
```

If automatic installation is not available on your machine, `extractor install` prints the manual command to run.

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

By default, `extractor` behaves like curl for content:

- input: a URL as an argument or on stdin
- output: AI-ready Markdown on stdout
- logs: progress and status on stderr
- AI: off by default; opt in with `--summarize`

That means it composes cleanly with shell tools:

```bash
extractor 'https://paulgraham.com/superlinear.html' > article.md
extractor --json 'https://example.com/article' | jq .
```

## Doctor

`extractor doctor` reports:

- installed tools
- configured API keys
- available capabilities
- recommended next actions

For agents and scripts, use JSON:

```bash
extractor doctor --json
```

## JS API

Use the same extraction engine directly from Node.js or TypeScript:

```ts
import {
  ExtractorError,
  extract,
  getInstallPlan,
  inspect,
  probeEnvironment,
  render,
} from "@zvadaadam/extractor";

const url = "https://www.youtube.com/watch?v=3mFNpeJQjmw&t=1315s";

const inspection = await inspect(url);
if (!inspection.ready) {
  console.log(inspection.issues);
}

try {
  const result = await extract(url);

  console.log(result.type);
  console.log(result.markdown);
  console.log(render(result, "json"));
} catch (error) {
  if (error instanceof ExtractorError) {
    console.log(error.code);
    console.log(error.issue.setupCommand);
  }
}

const environment = await probeEnvironment();
const installPlan = await getInstallPlan("youtube");
```

`extract(url, options?)` returns an agent-friendly object:

- `type`, `title`, `source`, `summary`
- `markdown` for AI-ready Markdown
- `text` for plain text
- `json` for structured data

`inspect(url, options?)` returns a preflight result:

- detected `type`
- `ready` boolean
- structured `issues`
- extraction and summary capability info

## Troubleshooting

If YouTube extraction fails, run:

```bash
extractor doctor
extractor install
```

If you only want the YouTube dependency:

```bash
extractor install youtube
```

If summaries do not run, either install a supported CLI:

```bash
extractor install codex
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
```

## License

MIT
