import { describe, test, expect } from "bun:test";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createManagedTools } from "./fixtures/tools";

const CLI = [process.execPath, "run", "src/bin.ts"];
const NO_TOOLS_ENV = { PATH: "/tmp/outform-no-tools", OUTFORM_TOOLS_DIR: "/tmp/outform-no-tools" };

function run(args: string[], envOverrides: Record<string, string | undefined> = {}) {
  return Bun.spawn([...CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", OUTFORM_TOOLS_DIR: "/tmp/outform-no-tools", ...envOverrides },
  });
}

async function collect(proc: ReturnType<typeof Bun.spawn>) {
  const stdout = await new Response(proc.stdout as ReadableStream).text();
  const stderr = await new Response(proc.stderr as ReadableStream).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function createFakeToolPath(commands: string[]): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "outform-tools-"));

  for (const command of commands) {
    const file = join(dir, command);
    await writeFile(file, "#!/bin/sh\nexit 0\n");
    await chmod(file, 0o755);
  }

  return {
    dir,
    path: `${dir}:/usr/bin:/bin`,
  };
}

describe("CLI flags", () => {
  test("install accepts multiple targets and includes each companion once", async () => {
    const result = await collect(run(["install", "youtube", "ffmpeg", "youtube", "--dry-run", "--json"], NO_TOOLS_ENV));
    expect(result.exitCode).toBe(0);
    const targets = JSON.parse(result.stdout).plans.map((plan: { target: string }) => plan.target);
    expect(targets).toEqual(["deno", "youtube", "ffmpeg"]);
  });

  test("invalid later setup targets fail before mutation and return structured JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "outform-invalid-setup-"));
    try {
      const result = await collect(
        run(["install", "youtube", "unknown", "--json"], { ...NO_TOOLS_ENV, OUTFORM_TOOLS_DIR: dir }),
      );
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ready: false,
        results: [],
        issues: [{ code: "UNKNOWN_SETUP_TARGET" }],
      });
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("argument errors remain JSON-readable and removed summary flag explains migration", async () => {
    for (const args of [
      ["install", "--not-an-option", "--json"],
      ["--summarize", "--json"],
    ]) {
      const result = await collect(run(args, NO_TOOLS_ENV));
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout).issues[0].code).toBe("INVALID_OPTIONS");
    }
    const result = await collect(run(["--summarize", "--json"], NO_TOOLS_ENV));
    expect(JSON.parse(result.stdout).issues[0].message).toContain("--chapters");
  });

  test("--help prints curl-style usage and exits 0", async () => {
    const { stdout, exitCode } = await collect(run(["--help"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("outform - curl for AI-ready content");
    expect(stdout).toContain("--json");
    expect(stdout).toContain("--text");
    expect(stdout).toContain("--chapters");
    expect(stdout).toContain("--output");
    expect(stdout).toContain("doctor");
    expect(stdout).toContain("install");
  });

  test("-h is shorthand for --help", async () => {
    const { stdout, exitCode } = await collect(run(["-h"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("outform - curl for AI-ready content");
  });

  test("--version prints version and exits 0", async () => {
    const { stdout, exitCode } = await collect(run(["--version"]));
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^outform v\d+\.\d+\.\d+\n$/);
  });

  test("--check prints status table with tools, env vars, and capabilities", async () => {
    const { stderr, exitCode } = await collect(run(["--check"]));
    expect(exitCode).toBe(0);
    expect(stderr).toContain("dependency check");
    expect(stderr).toContain("Tools:");
    expect(stderr).toContain("yt-dlp");
    expect(stderr).toContain("whisper.cpp");
    expect(stderr).toContain("claude CLI");
    expect(stderr).toContain("codex CLI");
    expect(stderr).toContain("Environment:");
    expect(stderr).toContain("ANTHROPIC_API_KEY");
    expect(stderr).toContain("OPENAI_API_KEY");
    expect(stderr).toContain("ffmpeg");
    expect(stderr).toContain("Capabilities:");
    expect(stderr).toContain("Web page extraction");
    expect(stderr).toContain("PDF extraction");
    expect(stderr).toContain("YouTube extraction");
    expect(stderr).toContain("Audio transcription");
    expect(stderr).toContain("AI chapter generation");
  });
});

describe("CLI error handling", () => {
  test("no source prints error to stderr and exits 1", async () => {
    const { stderr, stdout, exitCode } = await collect(run([]));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("No source provided");
    expect(stderr).toContain("--help");
    expect(stdout).toBe("");
  });

  test("invalid URL prints error to stderr and exits 1", async () => {
    const { stderr, exitCode } = await collect(run(["not-a-url"]));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid URL");
  });

  test("invalid format prints error to stderr and exits 1", async () => {
    const { stderr, exitCode } = await collect(run(["--format", "xml", "https://example.com"]));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid format");
    expect(stderr).toContain("xml");
  });

  test("conflicting --json and --text flags fail", async () => {
    const { stderr, exitCode } = await collect(run(["--json", "--text", "https://example.com"]));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Choose only one of --json or --text");
  });

  test("conflicting --raw and --chapters flags fail", async () => {
    const { stderr, exitCode } = await collect(run(["--raw", "--chapters", "https://example.com"]));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Use either --chapters or --raw");
  });

  test("invalid provider prints error to stderr and exits 1", async () => {
    const { stderr, exitCode } = await collect(run(["--chapters", "--provider", "invalid", "https://example.com"]));
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown provider "invalid"');
    expect(stderr).toContain("claude, codex, or none");
  });

  test("provider requires chapters unless set to none", async () => {
    const { stderr, exitCode } = await collect(run(["--provider", "codex", "https://example.com"]));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Use --provider together with --chapters");
  });
});

describe("CLI local file extraction", () => {
  test("reads Markdown from a local path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "outform-local-"));
    const file = join(dir, "release-notes.md");
    await writeFile(file, "# Release notes\n\nOutform reads local files.");

    try {
      const { stdout, stderr, exitCode } = await collect(run([file]));
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Outform reads local files.");
      expect(stdout).toContain(`**Source:** ${file}`);
      expect(stderr).toContain("Reading file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("CLI YouTube handling", () => {
  test("YouTube URL without yt-dlp prints helpful install error", async () => {
    const { stderr, exitCode } = await collect(run(["https://www.youtube.com/watch?v=dQw4w9WgXcQ"], NO_TOOLS_ENV));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Detected type: youtube");
    expect(stderr).toContain("yt-dlp");
    expect(stderr).toContain("outform install youtube");
  });

  test("--lang flag is accepted and passed to YouTube extractor", async () => {
    const { stderr, exitCode } = await collect(
      run(["--lang", "es", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"], NO_TOOLS_ENV),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("yt-dlp");
  });

  test("--lang flag is silently ignored for non-YouTube URLs", async () => {
    const { stdout, exitCode } = await collect(run(["--lang", "fr", "https://paulgraham.com/superlinear.html"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# ");
    expect(stdout.length).toBeGreaterThan(1000);
  });
});

describe("CLI compatibility aliases", () => {
  test("--provider none skips AI summary", async () => {
    const { stdout, exitCode } = await collect(run(["--provider", "none", "https://paulgraham.com/superlinear.html"]));
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("## Summary");
    expect(stdout).toContain("## Content");
  });

  test("legacy --raw and --stdout flags still work", async () => {
    const { stdout, exitCode } = await collect(run(["--raw", "--stdout", "https://paulgraham.com/superlinear.html"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# ");
    expect(stdout).toContain("## Content");
  });
});

describe("CLI --help content", () => {
  test("--help documents chapters and output flags", async () => {
    const { stdout, exitCode } = await collect(run(["--help"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--chapters");
    expect(stdout).toContain("--output");
    expect(stdout).toContain("--lang");
  });

  test("--help shows key extraction examples", async () => {
    const { stdout } = await collect(run(["--help"]));
    expect(stdout).toContain("youtube.com");
    expect(stdout).toContain("example.com/article");
  });
});

describe("CLI web extraction end-to-end", () => {
  test("default mode outputs markdown to stdout", async () => {
    const { stdout, stderr, exitCode } = await collect(run(["https://paulgraham.com/superlinear.html"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# ");
    expect(stdout).toContain("paulgraham.com");
    expect(stdout).toContain("Content");
    expect(stdout.length).toBeGreaterThan(1000);
    expect(stderr).toContain("Detected type: web");
    expect(stderr).toContain("Fetching page");
  });

  test("--json outputs valid JSON", async () => {
    const { stdout, exitCode } = await collect(run(["--json", "https://paulgraham.com/superlinear.html"]));
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.type).toBe("web");
    expect(parsed.source).toBe("https://paulgraham.com/superlinear.html");
    expect(parsed.content.length).toBeGreaterThan(1000);
    expect(parsed).not.toHaveProperty("summary");
  });

  test("--text outputs plain text", async () => {
    const { stdout, exitCode } = await collect(run(["--text", "https://paulgraham.com/superlinear.html"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Source: https://paulgraham.com/superlinear.html");
    expect(stdout).not.toContain("# ");
    expect(stdout).not.toContain("**");
  });

  test("--output writes file and keeps stdout empty", async () => {
    const outputPath = `/tmp/outform-tests/web-${Date.now()}.md`;

    await rm(outputPath, { force: true });

    try {
      const { stdout, stderr, exitCode } = await collect(
        run(["--output", outputPath, "https://paulgraham.com/superlinear.html"]),
      );
      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toContain(`Saved to ${outputPath}`);

      const content = await readFile(outputPath, "utf-8");
      expect(content).toContain("# ");
      expect(content.length).toBeGreaterThan(1000);
    } finally {
      await rm(outputPath, { force: true });
    }
  });
});

describe("CLI PDF extraction end-to-end", () => {
  test("default mode extracts PDF content", async () => {
    const { stdout, stderr, exitCode } = await collect(run(["https://arxiv.org/pdf/2301.00001.pdf"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# ");
    expect(stdout).toContain("Pages:");
    expect(stdout.length).toBeGreaterThan(500);
    expect(stderr).toContain("Detected type: pdf");
    expect(stderr).toContain("Downloading PDF");
  });
});

describe("CLI Content-Type PDF detection", () => {
  test("URL serving PDF without .pdf extension is detected via Content-Type", async () => {
    const { stdout, stderr, exitCode } = await collect(run(["https://arxiv.org/pdf/2301.00001"]));
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Detected type: pdf");
    expect(stdout).toContain("# ");
    expect(stdout).toContain("Pages:");
    expect(stdout.length).toBeGreaterThan(500);
  });
});

describe("CLI output file formats", () => {
  test("--json with --output writes JSON file", async () => {
    const outputPath = `/tmp/outform-tests/web-${Date.now()}.json`;

    await rm(outputPath, { force: true });

    try {
      const { stdout, exitCode } = await collect(
        run(["--json", "--output", outputPath, "https://paulgraham.com/superlinear.html"]),
      );
      expect(exitCode).toBe(0);
      expect(stdout).toBe("");

      const content = await readFile(outputPath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.type).toBe("web");
    } finally {
      await rm(outputPath, { force: true });
    }
  });

  test("--text with --output writes plain text file", async () => {
    const outputPath = `/tmp/outform-tests/web-${Date.now()}.txt`;

    await rm(outputPath, { force: true });

    try {
      const { stdout, exitCode } = await collect(
        run(["--text", "--output", outputPath, "https://paulgraham.com/superlinear.html"]),
      );
      expect(exitCode).toBe(0);
      expect(stdout).toBe("");

      const content = await readFile(outputPath, "utf-8");
      expect(content).not.toContain("# ");
    } finally {
      await rm(outputPath, { force: true });
    }
  });
});

describe("CLI output quality validation", () => {
  test("web markdown output contains no HTML noise", async () => {
    const { stdout, exitCode } = await collect(run(["https://paulgraham.com/superlinear.html"]));
    expect(exitCode).toBe(0);
    expect(stdout).not.toMatch(/<script[\s>]/);
    expect(stdout).not.toMatch(/<div[\s>]/);
    expect(stdout).not.toMatch(/<span[\s>]/);
    expect(stdout).not.toMatch(/<p[\s>]/);
    expect(stdout).not.toMatch(/<a\s/);
    expect(stdout).not.toContain("</div>");
    expect(stdout).not.toContain("</p>");
    expect(stdout).not.toContain("class=");
    expect(stdout).not.toContain("style=");
  });

  test("PDF markdown output contains no HTML noise", async () => {
    const { stdout, exitCode } = await collect(run(["https://arxiv.org/pdf/2301.00001.pdf"]));
    expect(exitCode).toBe(0);
    expect(stdout).not.toMatch(/<div[\s>]/);
    expect(stdout).not.toMatch(/<span[\s>]/);
    expect(stdout).not.toMatch(/<p[\s>]/);
    expect(stdout).not.toContain("</div>");
    expect(stdout).not.toContain("class=");
  });

  test("default markdown output skips AI summary", async () => {
    const { stdout, exitCode } = await collect(run(["https://paulgraham.com/superlinear.html"]));
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("## Summary");
    expect(stdout).toContain("## Content");
  });

  test("default JSON output contains source content without a summary", async () => {
    const { stdout, exitCode } = await collect(run(["--json", "https://paulgraham.com/superlinear.html"]));
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).not.toHaveProperty("summary");
  });
});

describe("CLI stdout/stderr separation", () => {
  test("content goes to stdout and progress goes to stderr", async () => {
    const { stdout, stderr, exitCode } = await collect(run(["https://paulgraham.com/superlinear.html"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# ");
    expect(stdout).toContain("## Content");
    expect(stdout).not.toMatch(/^\/tmp\/outform\//);
    expect(stderr).toContain("→");
    expect(stderr).toContain("Detected type: web");
  });
});

describe("CLI doctor and setup", () => {
  test("doctor --json outputs a machine-readable report", async () => {
    const { stdout, stderr, exitCode } = await collect(run(["doctor", "--json"]));
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.platform).toBeDefined();
    expect(parsed.arch).toBeDefined();
    expect(Array.isArray(parsed.tools)).toBe(true);
    expect(Array.isArray(parsed.env)).toBe(true);
    expect(parsed.capabilities.web.available).toBe(true);
    expect(parsed.capabilities.pdf.available).toBe(true);
    expect(parsed.capabilities.youtube).toBeDefined();
    expect(parsed.capabilities.aiChapters).toBeDefined();
  });

  test("install without a target prepares extraction without AI CLIs", async () => {
    const fixture = await createManagedTools();

    try {
      const { stdout, stderr, exitCode } = await collect(run(["install"], fixture.env));
      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toContain("yt-dlp is already installed");
      expect(stderr).toContain("whisper.cpp is already installed");
      expect(stderr).toContain("ffmpeg is already installed");
      expect(stderr).not.toContain("claude CLI");
      expect(stderr).not.toContain("codex CLI");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("setup remains a dry-run compatibility alias", async () => {
    const { stdout, exitCode } = await collect(run(["setup", "youtube"], NO_TOOLS_ENV));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("outform install youtube");
    expect(stdout).toContain("Enable YouTube extraction");
    expect(stdout).toContain("yt-dlp");
    expect(stdout).toContain("Manual install options");
  });

  test("setup all remains a dry-run compatibility alias", async () => {
    const { stdout, exitCode } = await collect(run(["setup", "all"], NO_TOOLS_ENV));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("outform install");
    expect(stdout).toContain("yt-dlp");
    expect(stdout).toContain("whisper.cpp");
    expect(stdout).toContain("claude CLI");
    expect(stdout).toContain("codex CLI");
    expect(stdout).toContain(
      "Run `outform install` to prepare extraction; `outform install all` also installs AI CLIs.",
    );
  });

  test("unknown install target exits 1 with a helpful error", async () => {
    const { stderr, exitCode } = await collect(run(["install", "unknown"]));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown install target");
    expect(stderr).toContain("youtube");
    expect(stderr).toContain("all");
  });
});

describe("managed setup", () => {
  test("dry-run JSON includes companions and excludes providers by default", async () => {
    const { stdout, stderr, exitCode } = await collect(run(["install", "--dry-run", "--json"], NO_TOOLS_ENV));
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout).plans.map((p: any) => p.target)).toEqual(["deno", "youtube", "ffmpeg", "whisper"]);
  });

  test("finds managed tools with no shell PATH setup and returns valid JSON", async () => {
    const fixture = await createManagedTools();
    try {
      const result = await collect(
        run(["install", "--json"], {
          PATH: "/tmp/outform-no-tools",
          ...fixture.env,
        }),
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        ready: true,
        results: [
          { target: "deno", status: "ready" },
          { target: "youtube", status: "ready" },
          { target: "ffmpeg", status: "ready" },
          { target: "whisper", status: "ready" },
        ],
      });
      expect(result.stderr).toContain("Extraction setup is ready");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("a broken executable returns a structured failure and nonzero exit", async () => {
    const fixture = await createManagedTools(["ffmpeg", "ffprobe"], { ffmpeg: "#!/bin/sh\necho broken >&2\nexit 1\n" });
    try {
      const result = await collect(run(["install", "ffmpeg", "--json"], fixture.env));
      expect(result.exitCode).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.ready).toBe(false);
      expect(report.results[0].issue.code).toBe("SETUP_FAILED");
      expect(report.results[0].issue.message).toContain("broken");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("whisper plan includes ffmpeg and ffprobe when missing", async () => {
    const result = await collect(run(["install", "whisper", "--dry-run", "--json"], NO_TOOLS_ENV));
    const plans = JSON.parse(result.stdout).plans;
    expect(plans.map((p: any) => p.target)).toEqual(["ffmpeg", "whisper"]);
    expect(plans[0].steps.map((s: any) => s.label)).toEqual(["ffmpeg b6.1.1", "ffprobe b6.1.1"]);
  });

  test("feedback help and validation never send feedback", async () => {
    const help = await collect(run(["feedback", "--help"]));
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("--resume");
    expect(help.stdout).toContain("--task");
    const invalid = await collect(run(["feedback", "--message", "short"]));
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stdout).toBe("");
    expect(invalid.stderr).toContain("40–5,000");
  });
});

test("installer subprocess output goes to stderr alongside JSON results", async () => {
  const fakeTools = await createFakeToolPath(["npm"]);
  await writeFile(
    join(fakeTools.dir, "npm"),
    `#!/bin/sh
printf 'package manager diagnostic\\n'
printf '#!/bin/sh\\nexit 0\\n' > "$OUTFORM_TEST_BIN/codex"
chmod +x "$OUTFORM_TEST_BIN/codex"
`,
  );
  try {
    const result = await collect(
      run(["install", "codex", "--json"], {
        PATH: fakeTools.path,
        OUTFORM_TEST_BIN: fakeTools.dir,
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).ready).toBe(true);
    expect(result.stderr).toContain("package manager diagnostic");
  } finally {
    await rm(fakeTools.dir, { recursive: true, force: true });
  }
});
