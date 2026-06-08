import { describe, test, expect } from "bun:test";
import { readFile, rm } from "fs/promises";

const CLI = [process.execPath, "run", "src/bin.ts"];
const NO_TOOLS_ENV = { PATH: "/tmp/extractor-no-tools" };

function run(args: string[], envOverrides: Record<string, string | undefined> = {}) {
  return Bun.spawn([...CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", ...envOverrides },
  });
}

async function collect(proc: ReturnType<typeof Bun.spawn>) {
  const stdout = await new Response(proc.stdout as ReadableStream).text();
  const stderr = await new Response(proc.stderr as ReadableStream).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("CLI flags", () => {
  test("--help prints curl-style usage and exits 0", async () => {
    const { stdout, exitCode } = await collect(run(["--help"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("extractor - curl for AI-ready content");
    expect(stdout).toContain("--json");
    expect(stdout).toContain("--text");
    expect(stdout).toContain("--summarize");
    expect(stdout).toContain("--output");
    expect(stdout).toContain("doctor");
    expect(stdout).toContain("install");
  });

  test("-h is shorthand for --help", async () => {
    const { stdout, exitCode } = await collect(run(["-h"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("extractor - curl for AI-ready content");
  });

  test("--version prints version and exits 0", async () => {
    const { stdout, exitCode } = await collect(run(["--version"]));
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^extractor v\d+\.\d+\.\d+\n$/);
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
    expect(stderr).toContain("Capabilities:");
    expect(stderr).toContain("Web page extraction");
    expect(stderr).toContain("PDF extraction");
    expect(stderr).toContain("YouTube extraction");
    expect(stderr).toContain("AI summarization");
  });
});

describe("CLI error handling", () => {
  test("no URL prints error to stderr and exits 1", async () => {
    const { stderr, stdout, exitCode } = await collect(run([]));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("No URL provided");
    expect(stderr).toContain("--help");
    expect(stdout).toBe("");
  });

  test("invalid URL prints error to stderr and exits 1", async () => {
    const { stderr, exitCode } = await collect(run(["not-a-url"]));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid URL");
  });

  test("invalid format prints error to stderr and exits 1", async () => {
    const { stderr, exitCode } = await collect(
      run(["--format", "xml", "https://example.com"]),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid format");
    expect(stderr).toContain("xml");
  });

  test("conflicting --json and --text flags fail", async () => {
    const { stderr, exitCode } = await collect(
      run(["--json", "--text", "https://example.com"]),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Choose only one of --json or --text");
  });

  test("conflicting --raw and --summarize flags fail", async () => {
    const { stderr, exitCode } = await collect(
      run(["--raw", "--summarize", "https://example.com"]),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Use either --summarize or --raw");
  });

  test("invalid provider prints error to stderr and exits 1", async () => {
    const { stderr, exitCode } = await collect(
      run(["--summarize", "--provider", "invalid", "https://example.com"]),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown provider "invalid"');
    expect(stderr).toContain("claude, codex, or none");
  });

  test("provider requires summarize unless set to none", async () => {
    const { stderr, exitCode } = await collect(
      run(["--provider", "codex", "https://example.com"]),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Use --provider together with --summarize");
  });
});

describe("CLI YouTube handling", () => {
  test("YouTube URL without yt-dlp prints helpful install error", async () => {
    const { stderr, exitCode } = await collect(
      run(["https://www.youtube.com/watch?v=dQw4w9WgXcQ"], NO_TOOLS_ENV),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Detected type: youtube");
    expect(stderr).toContain("yt-dlp");
    expect(stderr).toContain("brew install");
  });

  test("--lang flag is accepted and passed to YouTube extractor", async () => {
    const { stderr, exitCode } = await collect(
      run(["--lang", "es", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"], NO_TOOLS_ENV),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("yt-dlp");
  });

  test("--lang flag is silently ignored for non-YouTube URLs", async () => {
    const { stdout, exitCode } = await collect(
      run(["--lang", "fr", "https://paulgraham.com/superlinear.html"]),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# ");
    expect(stdout.length).toBeGreaterThan(1000);
  });
});

describe("CLI compatibility aliases", () => {
  test("--provider none skips AI summary", async () => {
    const { stdout, exitCode } = await collect(
      run(["--provider", "none", "https://paulgraham.com/superlinear.html"]),
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("## Summary");
    expect(stdout).toContain("## Content");
  });

  test("legacy --raw and --stdout flags still work", async () => {
    const { stdout, exitCode } = await collect(
      run(["--raw", "--stdout", "https://paulgraham.com/superlinear.html"]),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# ");
    expect(stdout).toContain("## Content");
  });
});

describe("CLI --help content", () => {
  test("--help documents summarize and output flags", async () => {
    const { stdout, exitCode } = await collect(run(["--help"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--summarize");
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
    const { stdout, stderr, exitCode } = await collect(
      run(["https://paulgraham.com/superlinear.html"]),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# ");
    expect(stdout).toContain("paulgraham.com");
    expect(stdout).toContain("Content");
    expect(stdout.length).toBeGreaterThan(1000);
    expect(stderr).toContain("Detected type: web");
    expect(stderr).toContain("Fetching page");
  });

  test("--json outputs valid JSON", async () => {
    const { stdout, exitCode } = await collect(
      run(["--json", "https://paulgraham.com/superlinear.html"]),
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.type).toBe("web");
    expect(parsed.source).toBe("https://paulgraham.com/superlinear.html");
    expect(parsed.content.length).toBeGreaterThan(1000);
    expect(parsed.summary).toBeNull();
  });

  test("--text outputs plain text", async () => {
    const { stdout, exitCode } = await collect(
      run(["--text", "https://paulgraham.com/superlinear.html"]),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Source: https://paulgraham.com/superlinear.html");
    expect(stdout).not.toContain("# ");
    expect(stdout).not.toContain("**");
  });

  test("--output writes file and keeps stdout empty", async () => {
    const outputPath = `/tmp/extractor-tests/web-${Date.now()}.md`;

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
    const { stdout, stderr, exitCode } = await collect(
      run(["https://arxiv.org/pdf/2301.00001.pdf"]),
    );
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
    const { stdout, stderr, exitCode } = await collect(
      run(["https://arxiv.org/pdf/2301.00001"]),
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Detected type: pdf");
    expect(stdout).toContain("# ");
    expect(stdout).toContain("Pages:");
    expect(stdout.length).toBeGreaterThan(500);
  });
});

describe("CLI output file formats", () => {
  test("--json with --output writes JSON file", async () => {
    const outputPath = `/tmp/extractor-tests/web-${Date.now()}.json`;

    await rm(outputPath, { force: true });

    try {
      const { stdout, exitCode } = await collect(
        run([
          "--json",
          "--output",
          outputPath,
          "https://paulgraham.com/superlinear.html",
        ]),
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
    const outputPath = `/tmp/extractor-tests/web-${Date.now()}.txt`;

    await rm(outputPath, { force: true });

    try {
      const { stdout, exitCode } = await collect(
        run([
          "--text",
          "--output",
          outputPath,
          "https://paulgraham.com/superlinear.html",
        ]),
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
    const { stdout, exitCode } = await collect(
      run(["https://paulgraham.com/superlinear.html"]),
    );
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
    const { stdout, exitCode } = await collect(
      run(["https://arxiv.org/pdf/2301.00001.pdf"]),
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toMatch(/<div[\s>]/);
    expect(stdout).not.toMatch(/<span[\s>]/);
    expect(stdout).not.toMatch(/<p[\s>]/);
    expect(stdout).not.toContain("</div>");
    expect(stdout).not.toContain("class=");
  });

  test("default markdown output skips AI summary", async () => {
    const { stdout, exitCode } = await collect(
      run(["https://paulgraham.com/superlinear.html"]),
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("## Summary");
    expect(stdout).toContain("## Content");
  });

  test("default JSON output includes null summary", async () => {
    const { stdout, exitCode } = await collect(
      run(["--json", "https://paulgraham.com/superlinear.html"]),
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.summary).toBeNull();
  });
});

describe("CLI stdout/stderr separation", () => {
  test("content goes to stdout and progress goes to stderr", async () => {
    const { stdout, stderr, exitCode } = await collect(
      run(["https://paulgraham.com/superlinear.html"]),
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# ");
    expect(stdout).toContain("## Content");
    expect(stdout).not.toMatch(/^\/tmp\/extractor\//);
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
    expect(parsed.capabilities.aiSummary).toBeDefined();
  });

  test("install without a target prints help", async () => {
    const { stdout, exitCode } = await collect(run(["install"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("extractor install <target>");
    expect(stdout).toContain("youtube");
    expect(stdout).toContain("codex");
    expect(stdout).toContain("all");
  });

  test("setup remains a dry-run compatibility alias", async () => {
    const { stdout, exitCode } = await collect(run(["setup", "youtube"], NO_TOOLS_ENV));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("extractor install youtube");
    expect(stdout).toContain("Enable YouTube extraction");
    expect(stdout).toContain("yt-dlp");
    expect(stdout).toContain("Manual install options");
  });

  test("setup all remains a dry-run compatibility alias", async () => {
    const { stdout, exitCode } = await collect(run(["setup", "all"], NO_TOOLS_ENV));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("extractor install all");
    expect(stdout).toContain("yt-dlp");
    expect(stdout).toContain("whisper.cpp");
    expect(stdout).toContain("claude CLI");
    expect(stdout).toContain("codex CLI");
    expect(stdout).toContain("extractor install all");
  });

  test("unknown install target exits 1 with a helpful error", async () => {
    const { stderr, exitCode } = await collect(run(["install", "unknown"]));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown install target");
    expect(stderr).toContain("youtube");
    expect(stderr).toContain("all");
  });
});
