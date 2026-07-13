Build a CLI tool called `outform` in TypeScript with Bun. It takes a URL and outputs clean, AI-ready markdown to a temp file.

```bash
outform <url>
```

**What it does**: Takes a URL (YouTube, web page, or PDF), extracts the text content, optionally runs it through an AI for summarization, and writes structured markdown to `/tmp/outform/`. The file path is printed to stdout so scripts/AI agents can capture it with `FILE=$(outform <url>)`. All progress/status goes to stderr.

**YouTube pipeline**: Use `yt-dlp --dump-json` for metadata. Try captions first (`yt-dlp --write-sub`), fall back to downloading audio + transcribing with `whisper.cpp`. Strip VTT/SRT timestamps, merge into flowing paragraphs. Extract chapters from metadata. Output: title, channel, description, chapters, transcript, and AI summary if available.

**Web pages**: Use `@mozilla/readability` to extract article text. Output: title, author, source, content, AI summary.

**PDF**: Use `unpdf` or `pdf-parse` to extract text. Output: title, page count, content, AI summary.

**AI provider auto-detection** (priority order): `claude` CLI (`which claude`, invoke with `-p` flag), `codex` CLI, `ANTHROPIC_API_KEY` env (direct API), `OPENAI_API_KEY` env. If nothing found, skip AI parts and output raw text. User can force with `--provider claude|codex|none` or `--raw`.

**Key flags**: `--raw` (skip AI), `--stdout` (print content instead of file path), `--format md|txt|json`, `--lang en` (caption language), `--check` (verify installed dependencies with clear install instructions), `--help`, `--version`.

**DX requirements**: Progress indicators for long ops (downloading, transcribing). Helpful errors — never bare `ENOENT`, always suggest `brew install yt-dlp`. Graceful degradation — no whisper means captions-only mode, no AI means raw text mode. `outform --check` prints a status table of all dependencies with install commands.

**Output convention**: stdout = only the file path. stderr = progress/status. Files go to `/tmp/outform/yt-{videoId}.md`, `web-{domain}-{hash}.md`, `pdf-{hash}.md`.

**Testing**: Smoke test with real URLs — a YouTube video with captions, `paulgraham.com/superlinear.html`, and an arxiv PDF. Validate output is valid markdown, contains full content, no HTML noise. Unit test URL detection, VTT stripping, chapter parsing, provider detection. The `--check` command should report exactly what's available and what's missing.

**Project setup**: `bun init`, structure as `src/extractors/`, `src/ai/`, `src/output/`, `src/utils/`. Add a `bin` field in package.json pointing to the entry. Make sure `bun run outform` works during dev. Include a `.gitignore` and basic README with usage examples.
