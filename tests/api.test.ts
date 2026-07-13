import { describe, test, expect } from "bun:test";

const NO_TOOLS_ENV = { PATH: "/tmp/outform-no-tools" };
const NO_CAPABILITIES_ENV = {
  PATH: "/tmp/outform-no-tools",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
};

function runEval(script: string, envOverrides: Record<string, string | undefined> = {}) {
  return Bun.spawn([process.execPath, "-e", script], {
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

describe("JS API", () => {
  test("extract() returns an agent-friendly result and stays quiet by default", async () => {
    const script = `
      import { extract } from "./src/index.ts";

      const result = await extract("https://paulgraham.com/superlinear.html");

      console.log(JSON.stringify({
        type: result.type,
        title: result.title,
        source: result.source,
        summary: result.summary,
        hasMarkdown: result.markdown.includes("## Content"),
        hasText: result.text.includes("Source:"),
        jsonType: result.json.type,
      }));
    `;

    const { stdout, stderr, exitCode } = await collect(runEval(script));
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Fetching page");
    expect(stderr).not.toContain("Parsing article content");

    const parsed = JSON.parse(stdout);
    expect(parsed.type).toBe("web");
    expect(parsed.title.length).toBeGreaterThan(0);
    expect(parsed.source).toBe("https://paulgraham.com/superlinear.html");
    expect(parsed.summary).toBeNull();
    expect(parsed.hasMarkdown).toBe(true);
    expect(parsed.hasText).toBe(true);
    expect(parsed.jsonType).toBe("web");
  });

  test("extract() can emit CLI-style progress when a logger is provided", async () => {
    const script = `
      import { extract, createStderrLogger } from "./src/index.ts";

      await extract("https://paulgraham.com/superlinear.html", {
        logger: createStderrLogger(),
      });
    `;

    const { stderr, exitCode } = await collect(runEval(script));
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Fetching page");
  });

  test("inspect() reflects actual AI summary capability when not requested", async () => {
    const script = `
      import { inspect } from "./src/index.ts";

      const result = await inspect("https://example.com");
      console.log(JSON.stringify({
        ready: result.ready,
        requested: result.capabilities.aiSummary.requested,
        available: result.capabilities.aiSummary.available,
        providers: result.capabilities.aiSummary.providers,
      }));
    `;

    const { stdout, exitCode } = await collect(runEval(script, NO_CAPABILITIES_ENV));
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.ready).toBe(true);
    expect(parsed.requested).toBe(false);
    expect(parsed.available).toBe(false);
    expect(parsed.providers).toEqual([]);
  });

  test("inspect() reports missing YouTube dependency with setup hints", async () => {
    const script = `
      import { inspect } from "./src/index.ts";

      const result = await inspect("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      console.log(JSON.stringify(result));
    `;

    const { stdout, exitCode } = await collect(runEval(script, NO_TOOLS_ENV));
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.type).toBe("youtube");
    expect(parsed.ready).toBe(false);
    expect(parsed.issues[0].code).toBe("MISSING_DEPENDENCY");
    expect(parsed.issues[0].setupCommand).toBe("outform install youtube");
  });

  test("extract() throws a typed error for missing YouTube dependency", async () => {
    const script = `
      import { extract, OutformError } from "./src/index.ts";

      try {
        await extract("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        console.log(JSON.stringify({ ok: true }));
      } catch (error) {
        if (error instanceof OutformError) {
          console.log(JSON.stringify({
            ok: false,
            code: error.code,
            setupCommand: error.issue.setupCommand,
            dependency: error.issue.dependency,
          }));
        } else {
          throw error;
        }
      }
    `;

    const { stdout, exitCode } = await collect(runEval(script, NO_TOOLS_ENV));
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("MISSING_DEPENDENCY");
    expect(parsed.setupCommand).toBe("outform install youtube");
    expect(parsed.dependency).toBe("yt-dlp");
  });

  test("render() formats the shared result as md, txt, or json", async () => {
    const script = `
      import { extract, render } from "./src/index.ts";

      const result = await extract("https://paulgraham.com/superlinear.html");

      console.log(JSON.stringify({
        mdHasContent: render(result, "md").includes("## Content"),
        txtHasSource: render(result, "txt").includes("Source: https://paulgraham.com/superlinear.html"),
        jsonType: JSON.parse(render(result, "json")).type,
      }));
    `;

    const { stdout, exitCode } = await collect(runEval(script));
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.mdHasContent).toBe(true);
    expect(parsed.txtHasSource).toBe(true);
    expect(parsed.jsonType).toBe("web");
  });

  test("probeEnvironment() and getInstallPlan() are available from the JS API", async () => {
    const script = `
      import { probeEnvironment, getInstallPlan } from "./src/index.ts";

      const environment = await probeEnvironment();
      const installPlan = await getInstallPlan("youtube");

      console.log(JSON.stringify({
        hasPlatform: Boolean(environment.platform),
        hasCapabilities: Boolean(environment.capabilities.youtube && environment.capabilities.aiSummary),
        setupTarget: installPlan.target,
        setupName: installPlan.name,
      }));
    `;

    const { stdout, exitCode } = await collect(runEval(script));
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.hasPlatform).toBe(true);
    expect(parsed.hasCapabilities).toBe(true);
    expect(parsed.setupTarget).toBe("youtube");
    expect(parsed.setupName).toBe("yt-dlp");
  });
});
