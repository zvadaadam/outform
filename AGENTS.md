# AGENTS.md

outform is a TypeScript CLI and JS API that turns URLs and local files into AI-ready Markdown, plain text, or JSON. Single npm package (`outform`), developed with Bun, runs on Node.

## Commands

```bash
bun install
bun test                      # all tests
bun test tests/api.test.ts    # one file
bun run typecheck
bun run format                # prettier --write (enforced in CI via format:check)
bun run build                 # npm package (tsup → dist/)
bun run build:binary          # standalone executables (→ artifacts/, gitignored)
bun run src/bin.ts <source>   # run the CLI from source
```

## Layout

- `src/bin.ts` — executable entry. `src/cli.ts` — arg parsing, help text, command dispatch.
- `src/api.ts` — public `extract`/`inspect`/`render` API. `src/index.ts` — package exports.
- `src/extractors/` — one file per source type: `web`, `pdf`, `youtube`.
- `src/output/formatter.ts` — Markdown/text/JSON rendering per source type.
- `src/ai/` — provider auto-detection and summarization.
- `src/setup.ts` — `outform install` planning and execution. `src/errors.ts` — `OutformError` with structured issues.
- `src/utils/` — dependency probing/doctor, URL/source detection, subprocess handling, stderr logging.
- `tests/` mirrors `src/`.
- `skills/outform/SKILL.md` — agent-facing usage skill, shipped in the npm package.

## Rules

- stdout carries content only; every log, spinner, and progress message goes to stderr via `src/utils/log.ts`. Never `console.log` diagnostics.
- Missing optional tools (yt-dlp, whisper, AI providers) must never crash extraction — degrade gracefully and report through structured `OutformIssue` values with actionable install hints.
- `src/` must stay Node-compatible (`engines` allows Node >= 20.16): no Bun-only APIs there. Bun APIs are fine in `scripts/` and tests.
- When adding or changing a CLI flag or command, update all three together: `HELP` in `src/cli.ts`, the README, and `skills/outform/SKILL.md`.
- Keep runtime dependencies minimal; the npm package and standalone binaries should stay small.
- Prefer editing existing modules over adding new top-level files; one domain concept per file.

## Releases

- CI (`.github/workflows/ci.yml`) runs format check, typecheck, tests, npm build, and a binary smoke test on every PR.
- Publishing is tag-driven via `.github/workflows/release.yml`: pushing `v*` publishes to npm and uploads standalone binaries to the GitHub release.
- The GitHub repo is named `extractor` for historical reasons; the product, package, CLI, and API are `outform`.
