import { parseArgs } from "node:util";
import type { SendFeedbackOptions, SendFeedbackResult } from "hivenet";
import { log, logError, logSuccess } from "./utils/log";
import { OutformError } from "./errors";
import packageJson from "../package.json" with { type: "json" };

export type FeedbackOptions = Pick<
  SendFeedbackOptions,
  "feedback" | "category" | "subject" | "eval" | "resume" | "question" | "attachments"
>;

export const FEEDBACK_HELP = `outform feedback — send feedback to the Outform team through Hivenet

Usage:
  outform feedback --message "<specific feedback, 40–5,000 characters>" [options]

Options:
  --message <text>          Specific, actionable feedback (required)
  --category <name>         Category (default: cli); any name without whitespace, max 64 characters
  --subject <item>          Exact command, API method, skill, or documentation URL
  --task <goal>            Reproducible failed task (requires --expected and --actual)
  --expected <outcome>     Correct outcome
  --actual <outcome>       Observed outcome
  --mistake <step>          Optional wrong step in a failed task
  --attempts <number>      Positive number of attempts
  --resume <thread>        Continue a feedback thread with something new
  --question <id>          Answer an ask on a resumed thread
  --attach <path>          Attach a file (repeatable; up to 10, 20 MiB each)
  --describe <text>        Describe the preceding attachment
  --json                   Print the delivery result, thread, guidance, and ask as JSON
  --help                   Show this help

Only the feedback command sends reports. Never include secrets or unrelated files.
DO_NOT_TRACK=1 disables automatically collected context.
If delivery throws before returning a receipt, --json reports queued: null (queue status unknown).
For JSON input and category discovery, use:
  npx --yes hivenet@^0.7.0 --registry https://hivenet.app --to outform --help
Dashboard: https://hivenet.app/p/outform`;

export async function submitFeedback(options: FeedbackOptions): Promise<SendFeedbackResult> {
  try {
    const { sendFeedback } = await import("hivenet");
    return await sendFeedback({
      ...options,
      to: "outform",
      registry: "https://hivenet.app",
      category: options.category ?? "cli",
      clientName: "outform-cli",
      clientVersion: packageJson.version,
    });
  } catch (error) {
    throw OutformError.fromUnknown(error, {
      code: "FEEDBACK_FAILED",
      capability: "feedback",
      message: "Could not submit feedback to Hivenet.",
    });
  }
}

export function parseFeedbackArgs(args: string[]): { options: FeedbackOptions; json: boolean } {
  const { values, positionals, tokens } = parseArgs({
    args,
    allowPositionals: true,
    tokens: true,
    options: {
      message: { type: "string" },
      category: { type: "string" },
      subject: { type: "string" },
      task: { type: "string" },
      expected: { type: "string" },
      actual: { type: "string" },
      mistake: { type: "string" },
      attempts: { type: "string" },
      resume: { type: "string" },
      question: { type: "string" },
      attach: { type: "string", multiple: true },
      describe: { type: "string", multiple: true },
      json: { type: "boolean", default: false },
    },
  });
  if (positionals.length) throw new Error("Use --message to provide feedback. See `outform feedback --help`.");
  const feedback = values.message?.trim() ?? "";
  if (feedback.length < 40 || feedback.length > 5000)
    throw new Error("Feedback must contain 40–5,000 characters after trimming whitespace.");
  if (values.category !== undefined && !/^\S{1,64}$/u.test(values.category))
    throw new Error("Category must be 1–64 characters without whitespace.");
  if (values.resume && !/^[A-Za-z0-9_-]{6,64}$/.test(values.resume))
    throw new Error("Invalid thread ID. Use the thread returned by a previous submission.");
  if (values.question && !values.resume) throw new Error("Use --question with --resume to answer on the same thread.");
  const hasEval = [values.task, values.expected, values.actual, values.mistake, values.attempts].some(
    (value) => value !== undefined,
  );
  if (hasEval && ![values.task, values.expected, values.actual].every((value) => value?.trim())) {
    throw new Error("Failed-task reports require --task, --expected, and --actual together.");
  }
  const attempts = values.attempts === undefined ? undefined : Number(values.attempts);
  if (attempts !== undefined && (!Number.isSafeInteger(attempts) || attempts < 1))
    throw new Error("--attempts must be a positive integer.");
  const attachments: { path: string; description?: string }[] = [];
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (token.name === "attach") attachments.push({ path: token.value! });
    if (token.name === "describe") {
      const last = attachments.at(-1);
      if (!last || last.description !== undefined) throw new Error("Place each --describe after its --attach.");
      last.description = token.value!;
    }
  }
  return {
    json: values.json,
    options: {
      feedback,
      category: values.category,
      subject: values.subject,
      resume: values.resume,
      question: values.question,
      ...(attachments.length ? { attachments } : {}),
      ...(hasEval
        ? {
            eval: {
              task: values.task!,
              expected: values.expected!,
              actual: values.actual!,
              mistake: values.mistake,
              attempts,
            },
          }
        : {}),
    },
  };
}

export async function runFeedbackCommand(args: string[], send = submitFeedback): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(FEEDBACK_HELP + "\n");
    return;
  }
  const { options, json } = parseFeedbackArgs(args);
  let result: SendFeedbackResult;
  try {
    result = await send(options);
  } catch (error) {
    const failure = OutformError.fromUnknown(error, {
      code: "FEEDBACK_FAILED",
      capability: "feedback",
      message: "Could not submit feedback to Hivenet.",
    });
    if (json)
      process.stdout.write(
        JSON.stringify({ delivered: false, queued: null, error: failure.message, issues: [failure.issue] }, null, 2) +
          "\n",
      );
    logError(`Feedback delivery could not be confirmed: ${failure.message}`);
    process.exitCode = 1;
    return;
  }
  const output = result.delivered
    ? {
        delivered: true,
        ...result.response,
        ...(result.filesNotAttached ? { filesNotAttached: result.filesNotAttached } : {}),
      }
    : { delivered: false, queued: result.queued, error: result.error, thread: result.event.thread.id };
  if (json) process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  if (!result.delivered) {
    logError(
      `Feedback was not delivered. ${result.queued ? "Saved in Hivenet's local outbox; use `npx --yes hivenet@^0.7.0 flush` to retry." : result.error}`,
    );
    process.exitCode = 1;
    return;
  }
  if (json) return;
  logSuccess(`Feedback delivered. Thread: ${result.response.thread}`);
  log(
    `Follow up with something new: outform feedback --resume ${result.response.thread} --message "<new observations>"`,
  );
  if (result.filesNotAttached) logError(`Some files were not attached: ${result.filesNotAttached.reason}`);
  if (result.response.guidance) log(`Outform guidance: ${result.response.guidance}`);
  if (result.response.known_issue) log(`Known issue (report recorded): ${result.response.known_issue.title}`);
  if (result.response.ask) {
    log(`Outform asks: ${result.response.ask.prompt}\nAnswer only from observed facts: ${result.response.ask.command}`);
  }
}
