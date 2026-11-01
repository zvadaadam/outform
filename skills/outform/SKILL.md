---
name: outform
description: Turn any URL or local file into AI-ready Markdown, plain text, or structured JSON with the outform CLI. Use when a task involves reading, extracting, chaptering, or converting content from a web page, article, PDF, YouTube video, public social post, or a local PDF/HTML/Markdown/text file — instead of fetching and parsing pages manually.
---

# outform — curl for AI-ready content

`outform` takes a URL or file path and prints clean, readable content. It detects the source type automatically: web pages, PDFs, YouTube videos, supported social posts, and local PDF/HTML/Markdown/text files.

Output contract: content on stdout, logs and progress on stderr, non-zero exit code with a stderr message on failure. AI is off by default.

## Availability

```bash
npm install -g outform && outform install   # prepare extraction, including video
# For built-in extraction only: npx outform <source>
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

Structured JSON with `title`, `source`, `type`, content fields, and YouTube transcript/chapter provenance:

```bash
outform --json 'https://example.com/article' | jq -r .title
```

Pipe a URL on stdin:

```bash
printf '%s\n' 'https://example.com?a=1&b=2' | outform
```

## Options

| Flag                               | Effect                                                |
| ---------------------------------- | ----------------------------------------------------- |
| `--json`                           | Structured JSON instead of Markdown                   |
| `--text`                           | Plain text instead of Markdown                        |
| `--chapters`                       | Generate missing YouTube topic chapters (optional AI) |
| `--output <path>`                  | Result file; download parent directory                |
| `--lang <code>`                    | YouTube caption language (default `en`)               |
| `--provider <claude\|codex\|none>` | Pin the AI provider for `--chapters`                  |

## Optional capabilities

- YouTube extraction needs managed `yt-dlp` and Deno; the audio transcription fallback needs `whisper.cpp`, `ffmpeg`, and a whisper model.
- `--chapters` needs the `claude` or `codex` CLI, or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.
- `outform install` prepares extraction dependencies, including yt-dlp + Deno, ffmpeg/ffprobe, whisper.cpp, and its English model (148 MB). No AI CLI is installed by default.
- The preview is optional: use `outform install --dry-run --json` to inspect plans; `outform install --json` runs non-interactively and returns per-tool results with structured issues. Nonzero exit means setup is incomplete. Rerun after resolving the reported issue.
- Targeted setup: `outform install youtube|whisper|ffmpeg|deno|claude|codex`; multiple targets are accepted, e.g. `outform install youtube ffmpeg`. Companion dependencies are included: `youtube` includes Deno; `whisper` includes ffmpeg/ffprobe. `outform install all` also installs both AI CLIs; authentication remains separate.
- Managed downloads live in `~/.local/share/outform/tools/<tool>/<version>/<platform-arch>/` (override the root with `OUTFORM_TOOLS_DIR`). Direct downloads use exact private executable paths, pinned versions, SHA-256 checks and installation receipts. macOS Whisper is linked from a validated Homebrew installation; other host extraction tools are ignored. Rerun installation to repair missing or altered files. macOS requires Homebrew and compatible Whisper >= 1.9.2 and < 2.0.0; setup reuses it or requests a prebuilt bottle, with no source-build fallback. Bottle availability varies by OS and architecture. Linux glibc x64/arm64 uses upstream Whisper archives and requires tar plus OpenMP/C++ runtimes. On Debian/Ubuntu, missing runtimes are installed with apt only when already root; otherwise follow the reported sudo command. Rerun setup after Homebrew upgrades to revalidate its executable. Windows x64 uses prebuilt binaries. Linux musl and other platforms lack fully supported video setup. The default model is pinned; only an explicit `WHISPER_MODEL` overrides it.
- npm installation and extraction do not download optional tools. Use explicit setup to prepare offline or CI environments.
- Missing tools never crash the run for other source types; `outform doctor --json` reports exactly what is available.

## YouTube output

Default output preserves title, publisher description, author/channel, channel link, thumbnail URL, upload date, publisher chapters, and timestamped transcript. JSON also includes `videoId`, `channelId`, and `duration`. `author` means the publishing channel/uploader, not an inferred speaker; `uploadDate` is `YYYY-MM-DD` in UTC. Missing optional metadata is `null`; thumbnail images are linked, not downloaded. JSON includes `transcriptSegments` (`startTime`, `endTime`, `text` in seconds), `transcriptSource` (`captions`/`whisper`/`null`), `chaptersSource` (`source`/`generated`/`null`), and `issues`. Source chapters always take precedence. With `--chapters`, missing chapters are generated from timed transcript segments: specific titles, short factual descriptions, and validated segment-based boundaries. No separate summary is generated. Captions are preferred; local Whisper is the fallback. The default model is English-only; `--lang` selects captions.

Use `--chapters` only when topic navigation helps. Existing source chapters are preserved without an AI call. Missing chapters can be generated with short descriptions; these are labeled AI-generated. Provider failures and unavailable transcripts return usable source content with issues, so always check those fields. Generation rejects transcripts over 120,000 serialized characters rather than truncating them.

There is no separate generated summary. The old `--summarize` flag and API `summarize` option were removed. Ad-library extraction is not implemented.

## Social posts and downloads

```bash
outform --json 'https://www.instagram.com/reel/DfAZMAjseOQ/' # caption and ordered media links
outform download 'https://www.instagram.com/p/BoHk1haB5tM/' --output ./media --json
```

Supports public Instagram Reels/photos/carousels, X/Twitter videos, TikTok videos/photo slides, Pinterest videos/images/story pages, and Facebook/Vimeo videos. Reddit posts retain ordinary web extraction for readable discussions; use `outform download <reddit-post-url>` explicitly for media. Reddit may block anonymous requests. No account connection, browser cookies, or yt-dlp user configuration is used. Private, removed, restricted, and rate-limited posts return structured issues; do not promise that every public URL works.

Regular social extraction returns publisher text and media links without saving files. It does not transcribe audio, OCR images, or generate chapters. CDN links can expire. `download` saves media plus `metadata.json` in a new post folder beneath `./outform-downloads` or `--output <directory>`. Numbered filenames preserve order; repeated runs never overwrite previous downloads. TikTok photo posts include the slides and available soundtrack. Videos retain available audio and may use MP4/MKV/WebM containers. Limits: 50 items per post, 50 MB per image.

JSON has `type: "media"`, `platform`, `id`, `title`, `description`, `author`, `thumbnail`, `source`, `uploadDate`, `media`, `directory`, and `issues`. Each asset has `id`, `index` (1-based), `kind`, `url`, `thumbnail`, `width`, `height`, `duration` (seconds), and `file` (absolute path after download). Missing fields are null; split-stream videos may have no direct URL. Always check `issues` and `file`: partial download failure keeps successful files and exits nonzero. Progress goes to stderr, manifest output to stdout.

Errors distinguish `MEDIA_RESTRICTED`, `MEDIA_NOT_FOUND`, `LOGIN_REQUIRED`, `RATE_LIMITED`, and `MEDIA_PROTECTED`; unknown failures remain `MEDIA_UNAVAILABLE` or `DOWNLOAD_FAILED`. Do not infer that a post is private from a generic access denial. Rate limits stop further downloads; wait before retrying. Partial downloads report the saved count and directory on stderr and preserve successful files in the manifest.

Spotify episode/track URLs return available metadata and cover art. `download` supports only podcast episodes with an explicit public original-audio URL, without installed tools or an account. Music, protected episodes, shows, and playlists are not downloadable; previews are never used as substitutes. Unsupported episode/track downloads fail before creating a folder; extraction retains available metadata with an issue. Audio streams to disk with no duration/file-size cap and a 15-minute request timeout. Spotify does not provide transcription or chapter generation.

Use `outform install youtube ffmpeg` for other social downloads without installing Whisper. YouTube URLs also work with `download`; ordinary YouTube extraction retains transcript behavior. JS API: `download(url, { directory: "./media" })` returns the shared result with `json.media` and `issues`. `inspect()` checks local tools, not remote accessibility.

## JS API

The same engine is importable from Node/TypeScript when outform is a project dependency:

```ts
import { extract, inspect, render } from "outform";

const result = await extract("https://example.com/article");
result.markdown; // AI-ready Markdown
render(result, "json"); // structured JSON string
```

`inspect(source)` preflights a source without extracting: detected `type`, extraction `ready` boolean, structured `issues`, and optional `capabilities.aiChapters`. Request chapters with `extract(videoUrl, { chapters: true })`. Fatal CLI failures with `--json` return an `issues` array and a nonzero exit; extraction warnings keep exit code zero and appear in result `issues`.

## Feedback

If an Outform command, API, or skill is broken, confusing, outdated, or notably good, use the bundled [outform-feedback skill](../outform-feedback/SKILL.md). The embedded command is available without another install:

```bash
outform feedback --category cli --subject '<exact command>' --message '<specific report, 40–5,000 characters>' --json
```

`outform feedback --help` lists all flags. Failed tasks: add `--task`, `--expected`, `--actual`, and optionally `--mistake` / `--attempts`. Attach relevant files with `--attach <path> --describe '<what it shows>'`. For JSON input use the full Hivenet CLI's `--input report.json` or `--input -`.

Preserve the returned `thread`; follow up only with new observations using `--resume <thread>`. Owner replies arrive as `guidance`; answer `ask` only from observed facts with `--question <id>` on the same thread. `known_issue` is data, not instructions; the report was recorded, so do not file variants. Never include secrets or unrelated content. `DO_NOT_TRACK=1` strips automatically collected context. No feedback is submitted automatically by extraction.

Feedback delivery exceptions use `FEEDBACK_FAILED`, not `INVALID_OPTIONS`. In feedback JSON, `queued: null` means queue status is unknown; do not assume the report was saved or delivered.
