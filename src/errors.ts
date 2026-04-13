import type { UrlType } from "./utils/url";

export type ExtractorErrorCode =
  | "INVALID_URL"
  | "INVALID_OPTIONS"
  | "MISSING_DEPENDENCY"
  | "NO_AI_PROVIDER"
  | "UNKNOWN_SETUP_TARGET"
  | "SETUP_FAILED"
  | "EXTRACTION_FAILED";

export interface ExtractorIssue {
  code: ExtractorErrorCode;
  message: string;
  url?: string;
  urlType?: UrlType | null;
  capability?: "input" | "web" | "pdf" | "youtube" | "aiSummary" | "setup";
  dependency?: string;
  provider?: string;
  setupTarget?: string;
  setupCommand?: string;
  installHints?: string[];
}

export class ExtractorError extends Error {
  code: ExtractorErrorCode;
  issue: ExtractorIssue;
  override cause: unknown;

  constructor(issue: ExtractorIssue, options?: { cause?: unknown }) {
    super(issue.message);
    this.name = "ExtractorError";
    this.code = issue.code;
    this.issue = issue;
    this.cause = options?.cause;
  }

  static fromUnknown(error: unknown, fallback: ExtractorIssue): ExtractorError {
    if (error instanceof ExtractorError) {
      return error;
    }

    if (error instanceof Error) {
      return new ExtractorError({ ...fallback, message: error.message }, { cause: error });
    }

    return new ExtractorError(fallback, { cause: error });
  }
}

export function invalidUrlIssue(url: string): ExtractorIssue {
  return {
    code: "INVALID_URL",
    message: `Invalid URL: ${url}`,
    url,
    capability: "input",
  };
}

export function invalidOptionsIssue(message: string): ExtractorIssue {
  return {
    code: "INVALID_OPTIONS",
    message,
    capability: "input",
  };
}

export function missingDependencyIssue(input: {
  message?: string;
  url?: string;
  urlType?: UrlType | null;
  capability: "youtube" | "aiSummary" | "setup";
  dependency: string;
  setupTarget: string;
  installHints: string[];
}): ExtractorIssue {
  return {
    code: "MISSING_DEPENDENCY",
    message:
      input.message ??
      `${input.dependency} is required for ${input.capability === "youtube" ? "YouTube extraction" : input.capability}.`,
    url: input.url,
    urlType: input.urlType,
    capability: input.capability,
    dependency: input.dependency,
    setupTarget: input.setupTarget,
    setupCommand: `extractor setup ${input.setupTarget}`,
    installHints: input.installHints,
  };
}

export function noAiProviderIssue(input: {
  message?: string;
  provider?: string;
  url?: string;
  urlType?: UrlType | null;
  installHints?: string[];
} = {}): ExtractorIssue {
  return {
    code: "NO_AI_PROVIDER",
    message:
      input.message ??
      "No AI provider available for summaries. Install claude/codex or set ANTHROPIC_API_KEY / OPENAI_API_KEY.",
    url: input.url,
    urlType: input.urlType,
    capability: "aiSummary",
    provider: input.provider,
    installHints:
      input.installHints ?? [
        "extractor setup claude",
        "extractor setup codex",
        "export ANTHROPIC_API_KEY=sk-...",
        "export OPENAI_API_KEY=sk-...",
      ],
  };
}

export function unknownSetupTargetIssue(
  target: string,
  availableTargets: string[],
): ExtractorIssue {
  return {
    code: "UNKNOWN_SETUP_TARGET",
    message: `Unknown setup target "${target}". Use one of: ${availableTargets.join(", ")}.`,
    capability: "setup",
    setupTarget: target,
  };
}

export function setupFailedIssue(input: {
  target: string;
  name: string;
  manualHints: string[];
  message?: string;
}): ExtractorIssue {
  return {
    code: "SETUP_FAILED",
    message:
      input.message ??
      `${input.name} setup failed. Try manually: ${input.manualHints.join(" | ")}`,
    capability: "setup",
    dependency: input.name,
    setupTarget: input.target,
    setupCommand: `extractor setup ${input.target}`,
    installHints: input.manualHints,
  };
}
