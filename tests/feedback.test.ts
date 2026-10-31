import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFeedbackArgs, runFeedbackCommand, submitFeedback } from "../src/feedback";

const message = "outform install failed on Ubuntu 24.04 after downloading the model; stderr says permission denied.";
const thread = "0123456789abcdef0123456789abcdef";

describe("feedback arguments", () => {
  test("preserves custom categories, evals, followups, and ordered attachments", () => {
    const parsed = parseFeedbackArgs([
      "--message",
      message,
      "--category",
      "setup_linux",
      "--subject",
      "outform install",
      "--task",
      "Prepare extraction on Ubuntu",
      "--expected",
      "All extraction tools ready",
      "--actual",
      "Permission denied",
      "--attempts",
      "2",
      "--mistake",
      "Used an unwritable tools directory",
      "--resume",
      thread,
      "--question",
      "q_123",
      "--attach",
      "first.log",
      "--describe",
      "First attempt",
      "--attach",
      "second.log",
      "--json",
    ]);
    expect(parsed.json).toBe(true);
    expect(parsed.options.category).toBe("setup_linux");
    expect(parsed.options.eval?.attempts).toBe(2);
    expect(parsed.options.resume).toBe(thread);
    expect(parsed.options.question).toBe("q_123");
    expect(parsed.options.attachments).toEqual([
      { path: "first.log", description: "First attempt" },
      { path: "second.log" },
    ]);
  });
  test("rejects incomplete or invalid reports before delivery", () => {
    for (const args of [
      ["--message", "short"],
      ["--message", message, "--category", "two words"],
      ["--message", message, "--task", "goal"],
      ["--message", message, "--question", "q_123"],
      ["--message", message, "--resume", "!invalid"],
      ["--message", message, "--describe", "missing file"],
      ["--message", message, "--task", "goal", "--expected", "ok", "--actual", "failed", "--attempts", "1.5"],
    ])
      expect(() => parseFeedbackArgs(args)).toThrow();
  });
});

describe("Hivenet integration", () => {
  const originalDnt = process.env.DO_NOT_TRACK;
  const originalHome = process.env.HIVENET_HOME;
  const originalDsn = process.env.HIVENET_DSN;
  let fetchSpy: ReturnType<typeof spyOn> | undefined;
  let stdoutSpy: ReturnType<typeof spyOn> | undefined;
  let stderrSpy: ReturnType<typeof spyOn> | undefined;
  let home: string | undefined;
  afterEach(async () => {
    fetchSpy?.mockRestore();
    stdoutSpy?.mockRestore();
    stderrSpy?.mockRestore();
    for (const [key, value] of Object.entries({
      DO_NOT_TRACK: originalDnt,
      HIVENET_HOME: originalHome,
      HIVENET_DSN: originalDsn,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.exitCode = 0;
    if (home) await rm(home, { recursive: true, force: true });
  });

  test("pins Outform, honors context opt-out, and carries replies through the real SDK", async () => {
    home = await mkdtemp(join(tmpdir(), "outform-feedback-"));
    process.env.HIVENET_HOME = home;
    process.env.DO_NOT_TRACK = "1";
    process.env.HIVENET_DSN = "https://hv_pub_000000000000000000000000@example.com/unrelated";
    let submitted: any;
    const reply = {
      id: "evt_test",
      thread,
      guidance: "Retry with a writable tools directory.",
      ask: { id: "q_test", prompt: "Did retrying work?", command: "example follow-up command" },
      known_issue: { title: "Unwritable tools directory", status: "open", reports: 2, hint: "Already recorded" },
    };
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input: any, init: any) => {
      const url = String(input);
      expect(url.startsWith("https://hivenet.app/")).toBe(true);
      if (init?.method === "POST") {
        submitted = JSON.parse(init.body);
        return Response.json(reply, { status: 202 });
      }
      return Response.json({ v: 1, name: "Outform", slug: "outform", endpoint: "https://hivenet.app/v1/feedback" });
    });
    const result = await submitFeedback({
      feedback: message,
      category: "api",
      resume: thread,
      question: "q_123",
      eval: { task: "Run install", expected: "Ready", actual: "Failed" },
    });
    expect(result.delivered).toBe(true);
    expect(submitted.to).toBe("outform");
    expect(submitted.client.name).toBe("outform-cli");
    expect(submitted.context).toBeUndefined();
    expect(submitted.consent.telemetry).toBe(false);
    expect(submitted.thread.id).toBe(thread);
    expect(submitted.eval.actual).toBe("Failed");
    expect(result.delivered && result.response).toEqual(reply);

    let stdout = "";
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      stdout += chunk;
      return true;
    });
    await runFeedbackCommand(["--message", message, "--json"], async () => result);
    expect(JSON.parse(stdout)).toEqual({ delivered: true, ...reply });
  });

  test("undelivered feedback reports failure instead of silent success", async () => {
    let stdout = "";
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      stdout += chunk;
      return true;
    });
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    await runFeedbackCommand(
      ["--message", message, "--json"],
      async () =>
        ({
          delivered: false,
          queued: true,
          error: "offline",
          event: { thread: { id: thread } },
        }) as any,
    );
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(stdout)).toEqual({ delivered: false, queued: true, error: "offline", thread });
  });

  test("registry failures are delivery errors with unknown queue status, not invalid options", async () => {
    let stdout = "";
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      stdout += chunk;
      return true;
    });
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    await runFeedbackCommand(["--message", message, "--json"], async () => {
      throw new Error("Hivenet registry request timed out");
    });
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(stdout)).toEqual({
      delivered: false,
      queued: null,
      error: "Hivenet registry request timed out",
      issues: [{ code: "FEEDBACK_FAILED", capability: "feedback", message: "Hivenet registry request timed out" }],
    });
  });
});
