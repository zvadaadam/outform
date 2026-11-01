import type { UrlType } from "./utils/url";

export type OutformErrorCode =
  | "INVALID_URL"
  | "INVALID_OPTIONS"
  | "MISSING_DEPENDENCY"
  | "NO_AI_PROVIDER"
  | "UNKNOWN_SETUP_TARGET"
  | "SETUP_FAILED"
  | "FEEDBACK_FAILED"
  | "EXTRACTION_FAILED"
  | "TRANSCRIPT_UNAVAILABLE"
  | "CHAPTER_GENERATION_FAILED"
  | "MEDIA_UNAVAILABLE"
  | "LOGIN_REQUIRED"
  | "MEDIA_RESTRICTED"
  | "MEDIA_NOT_FOUND"
  | "MEDIA_PROTECTED"
  | "RATE_LIMITED"
  | "DOWNLOAD_FAILED";

export interface OutformIssue {
  code: OutformErrorCode;
  message: string;
  url?: string;
  urlType?: UrlType | null;
  capability?: "input" | "web" | "pdf" | "youtube" | "media" | "aiChapters" | "transcription" | "setup" | "feedback";
  dependency?: string;
  provider?: string;
  setupTarget?: string;
  setupCommand?: string;
  installHints?: string[];
}

export class OutformError extends Error {
  code: OutformErrorCode;
  issue: OutformIssue;
  override cause: unknown;

  constructor(issue: OutformIssue, options?: { cause?: unknown }) {
    super(issue.message);
    this.name = "OutformError";
    this.code = issue.code;
    this.issue = issue;
    this.cause = options?.cause;
  }

  static fromUnknown(error: unknown, fallback: OutformIssue): OutformError {
    if (error instanceof OutformError) {
      return error;
    }

    if (error instanceof Error) {
      return new OutformError({ ...fallback, message: error.message }, { cause: error });
    }

    return new OutformError(fallback, { cause: error });
  }
}

export function invalidUrlIssue(url: string): OutformIssue {
  return {
    code: "INVALID_URL",
    message: `Invalid URL or file path: ${url}`,
    url,
    capability: "input",
  };
}

export function invalidOptionsIssue(message: string): OutformIssue {
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
  capability: "youtube" | "media" | "aiChapters" | "setup";
  dependency: string;
  setupTarget: string;
  installHints: string[];
}): OutformIssue {
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
    setupCommand: `outform install ${input.setupTarget}`,
    installHints: input.installHints,
  };
}

export function noAiProviderIssue(
  input: {
    message?: string;
    provider?: string;
    url?: string;
    urlType?: UrlType | null;
    installHints?: string[];
  } = {},
): OutformIssue {
  return {
    code: "NO_AI_PROVIDER",
    message:
      input.message ??
      "No AI provider available for chapter generation. Install claude/codex or set ANTHROPIC_API_KEY / OPENAI_API_KEY.",
    url: input.url,
    urlType: input.urlType,
    capability: "aiChapters",
    provider: input.provider,
    installHints: input.installHints ?? [
      "outform install claude",
      "outform install codex",
      "export ANTHROPIC_API_KEY=sk-...",
      "export OPENAI_API_KEY=sk-...",
    ],
  };
}

export function unknownSetupTargetIssue(target: string, availableTargets: string[]): OutformIssue {
  return {
    code: "UNKNOWN_SETUP_TARGET",
    message: `Unknown install target "${target}". Use one of: ${availableTargets.join(", ")}.`,
    capability: "setup",
    setupTarget: target,
  };
}

export function setupFailedIssue(input: {
  target: string;
  name: string;
  manualHints: string[];
  message?: string;
}): OutformIssue {
  return {
    code: "SETUP_FAILED",
    message: input.message ?? `${input.name} install failed. Try manually: ${input.manualHints.join(" | ")}`,
    capability: "setup",
    dependency: input.name,
    setupTarget: input.target,
    setupCommand: `outform install ${input.target}`,
    installHints: input.manualHints,
  };
}

export function mediaError(
  message: string,
  url: string,
  code: OutformIssue["code"] = "MEDIA_UNAVAILABLE",
): OutformError {
  return new OutformError({ code, capability: "media", urlType: "media", url, message });
}
export function mediaSourceFailure(stderr: string, url: string): OutformError {
  // Classify explicit site responses; a generic 403 does not prove a post is private.
  if (/fragment.*(?:not found|unable to continue)/i.test(stderr))
    return mediaError(
      "The video download stopped because a segment was unavailable. No incomplete video was saved. Retry the original post URL later.",
      url,
      "DOWNLOAD_FAILED",
    );
  if (/\b429\b|too many requests|rate[ -]?limit|try again in a few minutes/i.test(stderr))
    return mediaError(
      "The site is limiting requests from this connection. Wait a few minutes before retrying; repeated attempts may extend the limit.",
      url,
      "RATE_LIMITED",
    );
  if (/\bDRM\b|copyright protection|encrypted media/i.test(stderr))
    return mediaError(
      "This media is copy-protected (DRM). Outform cannot download protected streams. Try another public post.",
      url,
      "MEDIA_PROTECTED",
    );
  if (
    /private (?:video|post|account)|(?:video|post|account) is private|followers[ -]only|members[ -]only/i.test(stderr)
  )
    return mediaError(
      "The site reports that this post is private or limited to approved viewers. Outform only downloads anonymously accessible media. Try a public post.",
      url,
      "MEDIA_RESTRICTED",
    );
  if (
    /not available in your (?:country|region)|geo.?restrict|geo.?block|age[ -]restrict|confirm your age/i.test(stderr)
  )
    return mediaError(
      "The site restricts this media by age or location. It is not available anonymously from this connection. Try another public post.",
      url,
      "MEDIA_RESTRICTED",
    );
  if (/\b404\b|\b410\b|(?:video|post|media|content).{0,30}(?:removed|deleted|does not exist|not found)/i.test(stderr))
    return mediaError(
      "The site reports that this media is missing or removed. Check the original post URL in a browser for availability or a newer link.",
      url,
      "MEDIA_NOT_FOUND",
    );
  if (
    /login required|log(?:ged)?[ -]?in|sign[ -]?in|authentication is required|registered users|cookies.*authentication/i.test(
      stderr,
    )
  )
    return mediaError(
      "The site requires login for this request. The post may be restricted, or the site may be blocking anonymous access. Outform does not connect accounts or read browser cookies. Try another public post or retry later.",
      url,
      "LOGIN_REQUIRED",
    );
  if (/\b403\b|forbidden|access denied/i.test(stderr))
    return mediaError(
      "The site denied access to this media. It may be restricted, temporarily blocked, or its download link may have expired. Retry the original post URL later; this does not necessarily mean the post is private.",
      url,
      "MEDIA_RESTRICTED",
    );
  if (
    /timed? out|timeout|connection reset|unable to download webpage|network is unreachable|name resolution|ENOTFOUND|ECONNRESET/i.test(
      stderr,
    )
  )
    return mediaError(
      "Could not reach the media server. Check your connection and retry later; the site may be temporarily unavailable.",
      url,
    );
  return mediaError(
    "Outform could not read this site's media. The site may have changed or blocked the request; the exact reason is unknown. Retry later. If it persists, report the public post URL with outform feedback.",
    url,
  );
}
