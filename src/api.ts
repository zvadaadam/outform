import { extractPdf } from "./extractors/pdf";
import { extractWeb } from "./extractors/web";
import { extractYouTube } from "./extractors/youtube";
import {
  buildPdfJson,
  buildYouTubeJson,
  buildWebJson,
  formatPdfMarkdown,
  formatPdfText,
  formatYouTubeMarkdown,
  formatYouTubeText,
  formatWebMarkdown,
  formatWebText,
  type PdfJsonOutput,
  type YouTubeJsonOutput,
  type WebJsonOutput,
} from "./output/formatter";
import { detectProvider } from "./ai/provider";
import { summarize } from "./ai/summarize";
import { detectUrlType, isValidSource, isValidUrl, type UrlType } from "./utils/url";
import { probeEnvironment } from "./utils/deps";
import {
  OutformError,
  invalidOptionsIssue,
  invalidUrlIssue,
  missingDependencyIssue,
  noAiProviderIssue,
  type OutformIssue,
} from "./errors";
import { silentLogger, type ExtractLogger } from "./utils/log";

export type ExtractFormat = "md" | "txt" | "json";
export type ExtractProvider = "claude" | "codex" | "none";
export type ExtractJson = WebJsonOutput | PdfJsonOutput | YouTubeJsonOutput;

export interface ExtractOptions {
  summarize?: boolean;
  lang?: string;
  provider?: ExtractProvider;
  urlType?: UrlType;
  logger?: ExtractLogger;
}

export interface InspectOptions {
  summarize?: boolean;
  provider?: ExtractProvider;
  urlType?: UrlType;
}

export interface InspectCapability {
  available: boolean;
  capability: "web" | "pdf" | "youtube" | "aiSummary";
  dependency?: string;
  providers?: string[];
  setupCommand?: string;
  installHints?: string[];
}

export interface InspectResult {
  url: string;
  valid: boolean;
  type: UrlType | null;
  ready: boolean;
  summarize: boolean;
  provider: ExtractProvider | "auto";
  issues: OutformIssue[];
  capabilities: {
    extraction: InspectCapability;
    aiSummary: InspectCapability & {
      requested: boolean;
    };
  };
}

interface BaseExtractResult<TType extends UrlType, TJson extends ExtractJson> {
  type: TType;
  url: string;
  title: string;
  source: string;
  summary: string | null;
  markdown: string;
  text: string;
  json: TJson;
}

export type WebExtractResult = BaseExtractResult<"web", WebJsonOutput>;
export type PdfExtractResult = BaseExtractResult<"pdf", PdfJsonOutput>;
export type YouTubeExtractResult = BaseExtractResult<"youtube", YouTubeJsonOutput>;
export type ExtractResult = WebExtractResult | PdfExtractResult | YouTubeExtractResult;

const PROBE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

export async function resolveUrlType(url: string): Promise<UrlType> {
  let urlType = detectUrlType(url);

  if (urlType !== "web" || !isValidUrl(url)) {
    return urlType;
  }

  try {
    let contentType: string | null = null;

    try {
      const headResp = await fetch(url, {
        method: "HEAD",
        headers: PROBE_HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(5_000),
      });
      contentType = headResp.headers.get("content-type");
    } catch {
      const getResp = await fetch(url, {
        method: "GET",
        headers: PROBE_HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(5_000),
      });
      contentType = getResp.headers.get("content-type");
    }

    if (contentType?.includes("application/pdf")) {
      urlType = "pdf";
    }
  } catch {
    // Fall back to web extraction if probing fails.
  }

  return urlType;
}

function findTool(report: Awaited<ReturnType<typeof probeEnvironment>>, command: string): boolean {
  return report.tools.find((tool) => tool.command === command)?.found ?? false;
}

function findEnv(report: Awaited<ReturnType<typeof probeEnvironment>>, name: string): boolean {
  return report.env.find((item) => item.name === name)?.found ?? false;
}

function getAiIssue(
  report: Awaited<ReturnType<typeof probeEnvironment>>,
  provider: ExtractProvider | undefined,
  url: string,
  urlType: UrlType,
): OutformIssue | null {
  if (provider === "none") {
    return invalidOptionsIssue('Cannot summarize with provider "none". Choose claude, codex, or omit provider.');
  }

  if (!provider) {
    if (report.capabilities.aiSummary.available) {
      return null;
    }

    return noAiProviderIssue({
      url,
      urlType,
    });
  }

  if (provider === "claude" && !findTool(report, "claude")) {
    return missingDependencyIssue({
      url,
      urlType,
      capability: "aiSummary",
      dependency: "claude CLI",
      setupTarget: "claude",
      installHints: ["npm install -g @anthropic-ai/claude-code"],
      message:
        "Claude CLI is not available for summaries. Install it with:\n" + "  npm install -g @anthropic-ai/claude-code",
    });
  }

  if (provider === "codex" && !findTool(report, "codex")) {
    return missingDependencyIssue({
      url,
      urlType,
      capability: "aiSummary",
      dependency: "codex CLI",
      setupTarget: "codex",
      installHints: ["npm install -g @openai/codex"],
      message: "Codex CLI is not available for summaries. Install it with:\n" + "  npm install -g @openai/codex",
    });
  }

  return null;
}

export async function inspect(url: string, options: InspectOptions = {}): Promise<InspectResult> {
  if (!(await isValidSource(url))) {
    const issue = invalidUrlIssue(url);
    return {
      url,
      valid: false,
      type: null,
      ready: false,
      summarize: options.summarize ?? false,
      provider: options.provider ?? "auto",
      issues: [issue],
      capabilities: {
        extraction: {
          available: false,
          capability: "web",
        },
        aiSummary: {
          requested: options.summarize ?? false,
          available: false,
          capability: "aiSummary",
          providers: [],
        },
      },
    };
  }

  const urlType = options.urlType ?? (await resolveUrlType(url));
  const summarizeRequested = options.summarize ?? false;
  const provider = options.provider ?? "auto";
  const report = await probeEnvironment();
  const issues: OutformIssue[] = [];

  let extractionCapability: InspectCapability;
  switch (urlType) {
    case "youtube": {
      const available = report.capabilities.youtube.available;
      extractionCapability = {
        available,
        capability: "youtube",
        dependency: available ? undefined : "yt-dlp",
        setupCommand: available ? undefined : "outform install youtube",
        installHints: available ? undefined : ["brew install yt-dlp", "pip install yt-dlp"],
      };

      if (!available) {
        issues.push(
          missingDependencyIssue({
            url,
            urlType,
            capability: "youtube",
            dependency: "yt-dlp",
            setupTarget: "youtube",
            installHints: ["brew install yt-dlp", "pip install yt-dlp"],
            message:
              "yt-dlp is required for YouTube extraction. Install it with:\n" +
              "  brew install yt-dlp\n" +
              "  # or: pip install yt-dlp",
          }),
        );
      }
      break;
    }
    case "pdf": {
      extractionCapability = {
        available: true,
        capability: "pdf",
      };
      break;
    }
    case "web": {
      extractionCapability = {
        available: true,
        capability: "web",
      };
      break;
    }
  }

  const aiProviders = report.capabilities.aiSummary.providers ?? [];
  const aiCapability: InspectCapability & { requested: boolean } = {
    requested: summarizeRequested,
    available: report.capabilities.aiSummary.available,
    capability: "aiSummary",
    providers: aiProviders,
  };

  if (summarizeRequested) {
    const aiIssue = getAiIssue(report, options.provider, url, urlType);
    if (aiIssue) {
      aiCapability.available = false;
      aiCapability.dependency = aiIssue.dependency;
      aiCapability.setupCommand = aiIssue.setupCommand;
      aiCapability.installHints = aiIssue.installHints;
      issues.push(aiIssue);
    }
  }

  return {
    url,
    valid: true,
    type: urlType,
    ready: issues.length === 0,
    summarize: summarizeRequested,
    provider,
    issues,
    capabilities: {
      extraction: extractionCapability,
      aiSummary: aiCapability,
    },
  };
}

export async function extract(url: string, options: ExtractOptions = {}): Promise<ExtractResult> {
  const inspection = await inspect(url, options);
  if (!inspection.ready) {
    throw new OutformError(inspection.issues[0]!);
  }

  const logger = options.logger ?? silentLogger;
  const summarizeRequested = options.summarize ?? false;
  const lang = options.lang ?? "en";
  const urlType = inspection.type!;
  const provider = summarizeRequested
    ? await detectProvider(options.provider, false)
    : { type: "none" as const, name: "none" };

  try {
    switch (urlType) {
      case "web": {
        const result = await extractWeb(url, logger);
        const aiSummary = summarizeRequested ? await summarize(result.content, provider, logger) : null;
        const json = buildWebJson(result, aiSummary);

        return {
          type: "web",
          url,
          title: result.title,
          source: result.source,
          summary: aiSummary,
          markdown: formatWebMarkdown(result, aiSummary),
          text: formatWebText(result, aiSummary),
          json,
        };
      }
      case "youtube": {
        const result = await extractYouTube(url, lang, logger);
        const aiSummary = summarizeRequested ? await summarize(result.transcript, provider, logger) : null;
        const json = buildYouTubeJson(result, aiSummary);

        return {
          type: "youtube",
          url,
          title: result.title,
          source: result.source,
          summary: aiSummary,
          markdown: formatYouTubeMarkdown(result, aiSummary),
          text: formatYouTubeText(result, aiSummary),
          json,
        };
      }
      case "pdf": {
        const result = await extractPdf(url, logger);
        const aiSummary = summarizeRequested ? await summarize(result.content, provider, logger) : null;
        const json = buildPdfJson(result, aiSummary);

        return {
          type: "pdf",
          url,
          title: result.title,
          source: result.source,
          summary: aiSummary,
          markdown: formatPdfMarkdown(result, aiSummary),
          text: formatPdfText(result, aiSummary),
          json,
        };
      }
    }
  } catch (error: unknown) {
    throw OutformError.fromUnknown(error, {
      code: "EXTRACTION_FAILED",
      message: `Failed to extract content from ${url}`,
      url,
      urlType,
      capability: urlType,
    });
  }
}

export function render(result: ExtractResult, format: ExtractFormat = "md"): string {
  switch (format) {
    case "txt":
      return result.text;
    case "json":
      return JSON.stringify(result.json, null, 2);
    default:
      return result.markdown;
  }
}
