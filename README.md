# extractor

Extract clean, AI-ready markdown from any URL. Supports YouTube videos, web pages, and PDFs.

```bash
extractor <url>
```

Writes structured markdown to `/tmp/extractor/` and prints the file path to stdout, so you can capture it in scripts:

```bash
FILE=$(extractor https://paulgraham.com/superlinear.html)
cat "$FILE"
```

## Install

Requires [Bun](https://bun.sh).

```bash
bun install
```

Optional dependencies for full functionality:

| Tool | Purpose | Install |
|------|---------|---------|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | YouTube metadata & captions | `brew install yt-dlp` |
| [whisper.cpp](https://github.com/ggerganov/whisper.cpp) | Audio transcription fallback | `brew install whisper-cpp` |
| [claude](https://docs.anthropic.com/en/docs/claude-code) | AI summarization | `npm install -g @anthropic-ai/claude-code` |

Run `extractor --check` to see what's installed and what's missing.

## Usage

### Web pages

```bash
extractor https://paulgraham.com/superlinear.html
```

### YouTube videos

```bash
extractor "https://youtube.com/watch?v=dQw4w9WgXcQ"
```

### PDFs

```bash
extractor https://arxiv.org/pdf/2301.00001.pdf
```

### Options

```
--raw                 Skip AI summarization, output raw text
--stdout              Print content to stdout instead of file path
--format md|txt|json  Output format (default: md)
--lang <code>         Caption language for YouTube (default: en)
--provider <name>     Force AI provider (claude|codex|none)
--check               Verify installed dependencies
--version             Show version
--help                Show help
```

### Examples

Output as JSON to stdout:

```bash
extractor --format json --stdout https://example.com
```

Skip AI summarization:

```bash
extractor --raw https://example.com
```

Pipe into another tool:

```bash
cat "$(extractor https://paulgraham.com/superlinear.html)" | wc -w
```

## AI summarization

Extractor auto-detects available AI providers in this order:

1. `claude` CLI
2. `codex` CLI
3. `ANTHROPIC_API_KEY` environment variable
4. `OPENAI_API_KEY` environment variable

If none are found, it outputs raw extracted text. Use `--raw` to explicitly skip AI, or `--provider` to force a specific one.

## Output files

Files are written to `/tmp/extractor/` with deterministic names:

- YouTube: `yt-{videoId}.md`
- Web pages: `web-{domain}-{hash}.md`
- PDFs: `pdf-{hash}.md`

## Development

```bash
bun run extractor <url>    # Run during development
bun test                   # Run tests
```

## License

MIT
