import { describe, test, expect } from "bun:test";
import { readFile, rm } from "fs/promises";

const CLI = ["bun", "run", "src/index.ts"];

function run(args: string[]) {
  return Bun.spawn([...CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

async function collect(proc: ReturnType<typeof Bun.spawn>) {
  const stdout = await new Response(proc.stdout as ReadableStream).text();
  const stderr = await new Response(proc.stderr as ReadableStream).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("CLI flags", () => {
  test("--help prints usage and exits 0", async () => {
    const { stdout, exitCode } = await collect(run(["--help"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("extractor - Extract clean, AI-ready markdown");
    expect(stdout).toContain("--raw");
    expect(stdout).toContain("--stdout");
    expect(stdout).toContain("--format");
  });

  test("-h is shorthand for --help", async () => {
    const { stdout, exitCode } = await collect(run(["-h"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("extractor - Extract clean, AI-ready markdown");
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
    // Tools table
    expect(stderr).toContain("Tools:");
    expect(stderr).toContain("yt-dlp");
    expect(stderr).toContain("whisper.cpp");
    expect(stderr).toContain("claude CLI");
    expect(stderr).toContain("codex CLI");
    expect(stderr).toContain("brew install yt-dlp");
    // Environment table
    expect(stderr).toContain("Environment:");
    expect(stderr).toContain("ANTHROPIC_API_KEY");
    expect(stderr).toContain("OPENAI_API_KEY");
    // Capabilities summary
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
      run(["--format", "xml", "https://example.com"])
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid format");
    expect(stderr).toContain("xml");
  });

  test("invalid provider prints error to stderr and exits 1", async () => {
    const { stderr, exitCode } = await collect(
      run(["--provider", "invalid", "https://example.com"])
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown provider "invalid"');
    expect(stderr).toContain("claude, codex, or none");
  });
});

describe("CLI YouTube handling", () => {
  test("YouTube URL without yt-dlp prints helpful install error", async () => {
    const { stderr, exitCode } = await collect(
      run(["--raw", "--stdout", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"])
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Detected type: youtube");
    expect(stderr).toContain("yt-dlp");
    expect(stderr).toContain("brew install");
  });

  test("--lang flag is accepted and passed to YouTube extractor", async () => {
    const { stderr, exitCode } = await collect(
      run(["--raw", "--stdout", "--lang", "es", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"])
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("yt-dlp");
  });

  test("--lang flag is silently ignored for non-YouTube URLs", async () => {
    const { stdout, exitCode } = await collect(
      run(["--raw", "--stdout", "--lang", "fr", "https://paulgraham.com/superlinear.html"])
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# ");
    expect(stdout.length).toBeGreaterThan(1000);
  });
});

describe("CLI --provider none behaves like --raw", () => {
  test("--provider none skips AI summary", async () => {
    const { stdout, exitCode } = await collect(
      run(["--provider", "none", "--stdout", "https://paulgraham.com/superlinear.html"])
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("## Summary");
    expect(stdout).toContain("## Content");
  });

  test("--provider none produces null summary in JSON", async () => {
    const { stdout, exitCode } = await collect(
      run(["--provider", "none", "--stdout", "--format", "json", "https://paulgraham.com/superlinear.html"])
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.summary).toBeNull();
  });
});

describe("CLI --help content", () => {
  test("--help documents --lang flag with language code", async () => {
    const { stdout, exitCode } = await collect(run(["--help"]));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--lang");
    expect(stdout).toContain("Caption language");
  });

  test("--help shows all extraction examples", async () => {
    const { stdout } = await collect(run(["--help"]));
    expect(stdout).toContain("youtube.com");
    expect(stdout).toContain("paulgraham.com");
    expect(stdout).toContain("arxiv.org");
  });
});

describe("CLI web extraction end-to-end", () => {
  test("--stdout --raw outputs markdown to stdout", async () => {
    const { stdout, stderr, exitCode } = await collect(
      run(["--raw", "--stdout", "https://paulgraham.com/superlinear.html"])
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# ");
    expect(stdout).toContain("paulgraham.com");
    expect(stdout).toContain("Content");
    expect(stdout.length).toBeGreaterThan(1000);
    expect(stderr).toContain("Detected type: web");
    expect(stderr).toContain("Fetching page");
  });

  test("--stdout --raw --format json outputs valid JSON", async () => {
    const { stdout, exitCode } = await collect(
      run([
        "--raw",
        "--stdout",
        "--format",
        "json",
        "https://paulgraham.com/superlinear.html",
      ])
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.type).toBe("web");
    expect(parsed.source).toBe("https://paulgraham.com/superlinear.html");
    expect(parsed.content.length).toBeGreaterThan(1000);
    expect(parsed.summary).toBeNull();
  });

  test("--stdout --raw --format txt outputs plain text", async () => {
    const { stdout, exitCode } = await collect(
      run([
        "--raw",
        "--stdout",
        "--format",
        "txt",
        "https://paulgraham.com/superlinear.html",
      ])
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Source: https://paulgraham.com/superlinear.html");
    expect(stdout).not.toContain("# ");
    expect(stdout).not.toContain("**");
  });

  test("default mode writes file and prints path to stdout", async () => {
    const { stdout, stderr, exitCode } = await collect(
      run(["--raw", "https://paulgraham.com/superlinear.html"])
    );
    expect(exitCode).toBe(0);

    const filePath = stdout.trim();
    expect(filePath).toMatch(/^\/tmp\/extractor\/web-paulgraham\.com-[a-f0-9]+\.md$/);
    expect(stderr).toContain("Saved to");

    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("# ");
    expect(content.length).toBeGreaterThan(1000);
  });
});

describe("CLI PDF extraction end-to-end", () => {
  test("--stdout --raw extracts PDF content", async () => {
    const { stdout, stderr, exitCode } = await collect(
      run([
        "--raw",
        "--stdout",
        "https://arxiv.org/pdf/2301.00001.pdf",
      ])
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
      run([
        "--raw",
        "--stdout",
        "https://arxiv.org/pdf/2301.00001",
      ])
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Detected type: pdf");
    expect(stdout).toContain("# ");
    expect(stdout).toContain("Pages:");
    expect(stdout.length).toBeGreaterThan(500);
  });
});

describe("CLI output file extension matches format", () => {
  test("--format json produces .json file", async () => {
    const { stdout, exitCode } = await collect(
      run(["--raw", "--format", "json", "https://paulgraham.com/superlinear.html"])
    );
    expect(exitCode).toBe(0);
    const filePath = stdout.trim();
    expect(filePath).toMatch(/\.json$/);

    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.type).toBe("web");
  });

  test("--format txt produces .txt file", async () => {
    const { stdout, exitCode } = await collect(
      run(["--raw", "--format", "txt", "https://paulgraham.com/superlinear.html"])
    );
    expect(exitCode).toBe(0);
    const filePath = stdout.trim();
    expect(filePath).toMatch(/\.txt$/);

    const content = await readFile(filePath, "utf-8");
    expect(content).not.toContain("# ");
  });
});

describe("CLI output quality validation", () => {
  test("web markdown output contains no HTML noise", async () => {
    const { stdout, exitCode } = await collect(
      run(["--raw", "--stdout", "https://paulgraham.com/superlinear.html"])
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
      run(["--raw", "--stdout", "https://arxiv.org/pdf/2301.00001.pdf"])
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toMatch(/<div[\s>]/);
    expect(stdout).not.toMatch(/<span[\s>]/);
    expect(stdout).not.toMatch(/<p[\s>]/);
    expect(stdout).not.toContain("</div>");
    expect(stdout).not.toContain("class=");
  });

  test("--raw flag skips AI summary in markdown output", async () => {
    const { stdout, exitCode } = await collect(
      run(["--raw", "--stdout", "https://paulgraham.com/superlinear.html"])
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("## Summary");
    expect(stdout).toContain("## Content");
  });

  test("--raw flag produces null summary in JSON output", async () => {
    const { stdout, exitCode } = await collect(
      run(["--raw", "--stdout", "--format", "json", "https://paulgraham.com/superlinear.html"])
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.summary).toBeNull();
  });
});

describe("CLI stdout/stderr separation", () => {
  test("progress goes to stderr, only file path goes to stdout", async () => {
    const { stdout, stderr, exitCode } = await collect(
      run(["--raw", "https://paulgraham.com/superlinear.html"])
    );
    expect(exitCode).toBe(0);

    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\/tmp\/extractor\//);

    expect(stderr).toContain("→");
    expect(stderr).toContain("Saved to");
  });
});
