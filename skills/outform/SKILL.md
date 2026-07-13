---
name: outform
description: Turn any URL or local file into AI-ready Markdown, plain text, or structured JSON with the outform CLI. Use when a task involves reading, extracting, summarizing, or converting content from a web page, article, PDF, YouTube video, or a local PDF/HTML/Markdown/text file — instead of fetching and parsing pages manually.
---

# outform — curl for AI-ready content

`outform` takes a URL or file path and prints clean, readable content. It detects the source type automatically: web pages, PDFs, YouTube videos, and local PDF/HTML/Markdown/text files.

Output contract: content on stdout, logs and progress on stderr, non-zero exit code with a stderr message on failure. AI is off by default.

## Availability

```bash
outform --version || npm install -g outform
```

Web pages, PDFs, and local files work out of the box. For everything else, check capabilities with a machine-readable report:

```bash
outform doctor --json
```

## Core usage

```bash
outform 'https://example.com/article'                 # web page → Markdown on stdout
outform ./report.pdf                                  # local file → Markdown
outform 'https://www.youtube.com/watch?v=VIDEO_ID'    # video → metadata + transcript
```

Always quote URLs — `?` and `&` break shells.

## Patterns

Save to a file, then read it (keeps large content out of your context until needed):

```bash
outform --output /tmp/article.md 'https://example.com/article'
```

Structured JSON with `title`, `source`, `type`, content fields, and optional `summary`:

```bash
outform --json 'https://example.com/article' | jq -r .title
```

Pipe a URL on stdin:

```bash
printf '%s\n' 'https://example.com?a=1&b=2' | outform
```

## Options

| Flag                               | Effect                                             |
| ---------------------------------- | -------------------------------------------------- |
| `--json`                           | Structured JSON instead of Markdown                |
| `--text`                           | Plain text instead of Markdown                     |
| `--summarize`                      | Add an AI summary (requires a provider, see below) |
| `--output <path>`                  | Write to a file instead of stdout                  |
| `--lang <code>`                    | YouTube caption language (default `en`)            |
| `--provider <claude\|codex\|none>` | Pin the AI provider for `--summarize`              |

## Optional capabilities

- YouTube extraction needs `yt-dlp`; audio transcription fallback needs `whisper.cpp`.
- `--summarize` needs the `claude` or `codex` CLI, or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.
- Install optional tools automatically: `outform install` (all) or `outform install youtube|whisper|claude|codex`.
- Missing tools never crash the run for other source types; `outform doctor --json` reports exactly what is available.

## JS API

The same engine is importable from Node/TypeScript when outform is a project dependency:

```ts
import { extract, inspect, render } from "outform";

const result = await extract("https://example.com/article");
result.markdown; // AI-ready Markdown
render(result, "json"); // structured JSON string
```

`inspect(source)` preflights a source without extracting: detected `type`, `ready` boolean, and structured `issues`.
