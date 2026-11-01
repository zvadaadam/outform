import type { MediaSaveOptions } from "./extractors/media/metadata";
import { extractPdf } from "./extractors/pdf";
import { extractWeb } from "./extractors/web";
import { extractYouTube } from "./extractors/youtube";
import { extractMedia, downloadMedia, convertAudioFile, mediaDependencies, type MediaResult } from "./extractors/media";
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
  buildMediaJson,
  formatMediaMarkdown,
  formatMediaText,
  type MediaJsonOutput,
} from "./output/formatter";
import { detectProvider } from "./ai/provider";
import { generateChapters } from "./ai/chapters";
import { detectUrlType, mediaPlatform, isValidSource, isValidUrl, type UrlType } from "./utils/url";
import { hasCommand, installHintsFor, probeEnvironment } from "./utils/deps";
import {
  OutformError,
  invalidOptionsIssue,
  invalidUrlIssue,
  missingDependencyIssue,
  noAiProviderIssue,
  type OutformIssue,
} from "./errors";
import { silentLogger, logError, type ExtractLogger } from "./utils/log";

export type ExtractFormat = "md" | "txt" | "json";
export type ExtractProvider = "claude" | "codex" | "none";
export type ExtractJson = WebJsonOutput | PdfJsonOutput | YouTubeJsonOutput | MediaJsonOutput;

export interface ExtractOptions {
  chapters?: boolean;
  lang?: string;
  provider?: ExtractProvider;
  urlType?: UrlType;
  logger?: ExtractLogger;
}

export interface InspectOptions {
  chapters?: boolean;
  provider?: ExtractProvider;
  urlType?: UrlType;
}

export interface InspectCapability {
  available: boolean;
  capability: "web" | "pdf" | "youtube" | "media" | "aiChapters";
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
  chapters: boolean;
  provider: ExtractProvider | "auto";
  issues: OutformIssue[];
  capabilities: {
    extraction: InspectCapability;
    aiChapters: InspectCapability & {
      requested: boolean;
    };
  };
}

interface BaseExtractResult<TType extends UrlType, TJson extends ExtractJson> {
  type: TType;
  url: string;
  title: string;
  source: string;
  issues: OutformIssue[];
  markdown: string;
  text: string;
  json: TJson;
}

export type WebExtractResult = BaseExtractResult<"web", WebJsonOutput>;
export type PdfExtractResult = BaseExtractResult<"pdf", PdfJsonOutput>;
export type YouTubeExtractResult = BaseExtractResult<"youtube", YouTubeJsonOutput>;
export type MediaExtractResult = BaseExtractResult<"media", MediaJsonOutput>;
export type ExtractResult = WebExtractResult | PdfExtractResult | YouTubeExtractResult | MediaExtractResult;

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

function getAiIssue(
  report: Awaited<ReturnType<typeof probeEnvironment>>,
  provider: ExtractProvider | undefined,
  url: string,
  urlType: UrlType,
): OutformIssue | null {
  if (provider === "none") {
    return invalidOptionsIssue(
      'Cannot generate chapters with provider "none". Choose claude, codex, or omit provider.',
    );
  }

  if (!provider) {
    if (report.capabilities.aiChapters.available) {
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
      capability: "aiChapters",
      dependency: "claude CLI",
      setupTarget: "claude",
      installHints: ["npm install -g @anthropic-ai/claude-code"],
      message:
        "Claude CLI is not available for chapter generation. Install it with:\n" +
        "  npm install -g @anthropic-ai/claude-code",
    });
  }

  if (provider === "codex" && !findTool(report, "codex")) {
    return missingDependencyIssue({
      url,
      urlType,
      capability: "aiChapters",
      dependency: "codex CLI",
      setupTarget: "codex",
      installHints: ["npm install -g @openai/codex"],
      message:
        "Codex CLI is not available for chapter generation. Install it with:\n" + "  npm install -g @openai/codex",
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
      chapters: options.chapters ?? false,
      provider: options.provider ?? "auto",
      issues: [issue],
      capabilities: {
        extraction: {
          available: false,
          capability: "web",
        },
        aiChapters: {
          requested: options.chapters ?? false,
          available: false,
          capability: "aiChapters",
          providers: [],
        },
      },
    };
  }

  const urlType = options.urlType ?? (await resolveUrlType(url));
  const chaptersRequested = options.chapters ?? false;
  const provider = options.provider ?? "auto";
  if (urlType === "media") {
    const requirements = mediaDependencies(mediaPlatform(url));
    const missing: string[] = [];
    for (const dependency of requirements) if (!(await hasCommand(dependency))) missing.push(dependency);
    const available = missing.length === 0;
    const issues: OutformIssue[] = [];
    for (const dependency of missing)
      issues.push(
        missingDependencyIssue({
          capability: "media",
          dependency,
          setupTarget: "youtube",
          installHints: ["outform install"],
          url,
          urlType,
        }),
      );
    if (chaptersRequested) issues.push(invalidOptionsIssue("Chapter generation is supported for YouTube videos only."));
    if (options.provider && options.provider !== "none" && !chaptersRequested)
      issues.push(invalidOptionsIssue("Use provider together with chapters: true."));
    return {
      url,
      valid: true,
      type: urlType,
      ready: issues.length === 0,
      chapters: chaptersRequested,
      provider,
      issues,
      capabilities: {
        extraction: {
          available,
          capability: "media",
          ...(!available ? { dependency: missing[0], setupCommand: "outform install youtube" } : {}),
        },
        aiChapters: { requested: chaptersRequested, available: false, capability: "aiChapters", providers: [] },
      },
    };
  }
  const report = await probeEnvironment();
  const issues: OutformIssue[] = [];

  let extractionCapability: InspectCapability;
  switch (urlType) {
    case "youtube": {
      const available = report.capabilities.youtube.available;
      const missing = report.capabilities.youtube.requires ?? [];
      const dependency = missing[0] ?? "yt-dlp";
      const hints = [...installHintsFor("youtube"), ...(missing.includes("deno") ? installHintsFor("deno") : [])];
      extractionCapability = {
        available,
        capability: "youtube",
        dependency: available ? undefined : dependency,
        setupCommand: available ? undefined : "outform install youtube",
        installHints: available ? undefined : hints,
      };

      if (!available) {
        issues.push(
          missingDependencyIssue({
            url,
            urlType,
            capability: "youtube",
            dependency,
            setupTarget: "youtube",
            installHints: hints,
            message:
              `${missing.join(" + ")} required for YouTube extraction. Run \`outform install youtube\` to prepare it automatically, or use:\n` +
              hints.map((hint) => `  ${hint}`).join("\n"),
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

  const aiProviders = report.capabilities.aiChapters.providers ?? [];
  const aiCapability: InspectCapability & { requested: boolean } = {
    requested: chaptersRequested,
    available: report.capabilities.aiChapters.available,
    capability: "aiChapters",
    providers: aiProviders,
  };

  if (chaptersRequested && urlType !== "youtube") {
    issues.push(invalidOptionsIssue("Chapter generation is supported for YouTube videos only."));
  }
  if (options.provider && options.provider !== "none" && !chaptersRequested) {
    issues.push(invalidOptionsIssue("Use provider together with chapters: true."));
  }
  if (chaptersRequested) {
    const aiIssue = getAiIssue(report, options.provider, url, urlType);
    if (aiIssue) {
      aiCapability.available = false;
      aiCapability.dependency = aiIssue.dependency;
      aiCapability.setupCommand = aiIssue.setupCommand;
      aiCapability.installHints = aiIssue.installHints;
    }
  }

  return {
    url,
    valid: true,
    type: urlType,
    ready: issues.length === 0,
    chapters: chaptersRequested,
    provider,
    issues,
    capabilities: {
      extraction: extractionCapability,
      aiChapters: aiCapability,
    },
  };
}

export async function extract(url: string, options: ExtractOptions = {}): Promise<ExtractResult> {
  const inspection = await inspect(url, options);
  if (!inspection.ready) {
    throw new OutformError(inspection.issues[0]!);
  }

  const logger = options.logger ?? silentLogger;
  const chaptersRequested = options.chapters ?? false;
  const lang = options.lang ?? "en";
  const urlType = inspection.type!;

  try {
    switch (urlType) {
      case "media":
        return mediaExtractResult(url, await extractMedia(url, logger));
      case "web": {
        const result = await extractWeb(url, logger);
        const json = buildWebJson(result);

        return {
          type: "web",
          url,
          title: result.title,
          source: result.source,
          issues: [],
          markdown: formatWebMarkdown(result),
          text: formatWebText(result),
          json,
        };
      }
      case "youtube": {
        const result = await extractYouTube(url, lang, logger);
        if (chaptersRequested && !result.chapters?.length) {
          try {
            const provider = await detectProvider(options.provider, false);
            result.chapters = await generateChapters(result.transcriptSegments, result.duration, provider, logger);
            result.chaptersSource = "generated";
          } catch (error) {
            const issue: OutformIssue = {
              code: "CHAPTER_GENERATION_FAILED",
              capability: "aiChapters",
              url,
              urlType,
              message: `Could not generate chapters: ${error instanceof Error ? error.message : String(error)}. Available source content is still included.`,
            };
            result.issues.push(issue);
            logError(issue.message, logger);
          }
        }
        const json = buildYouTubeJson(result);

        return {
          type: "youtube",
          url,
          title: result.title,
          source: result.source,
          issues: result.issues,
          markdown: formatYouTubeMarkdown(result),
          text: formatYouTubeText(result),
          json,
        };
      }
      case "pdf": {
        const result = await extractPdf(url, logger);
        const json = buildPdfJson(result);

        return {
          type: "pdf",
          url,
          title: result.title,
          source: result.source,
          issues: [],
          markdown: formatPdfMarkdown(result),
          text: formatPdfText(result),
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

function mediaExtractResult(url: string, result: MediaResult): MediaExtractResult {
  return {
    type: "media",
    url,
    title: result.title,
    source: result.source,
    issues: result.issues,
    markdown: formatMediaMarkdown(result),
    text: formatMediaText(result),
    json: buildMediaJson(result),
  };
}

export interface DownloadOptions extends MediaSaveOptions {
  directory?: string;
  logger?: ExtractLogger;
}

/** Save a public post's media and metadata. Does not use accounts or browser cookies. */
export async function download(url: string, options: DownloadOptions = {}): Promise<MediaExtractResult> {
  try {
    return mediaExtractResult(
      url,
      await downloadMedia(url, options.directory ?? "./outform-downloads", options.logger, options),
    );
  } catch (error) {
    throw OutformError.fromUnknown(error, {
      code: "DOWNLOAD_FAILED",
      capability: "media",
      urlType: "media",
      url,
      message: "Could not download media.",
    });
  }
}

export type AudioOptions = Omit<DownloadOptions, "output" | "maxItems">;

/** Convert an existing local audio/video file to a verified MP3 without fetching its source. */
export async function convertAudio(path: string, options: AudioOptions = {}): Promise<MediaExtractResult> {
  return mediaExtractResult(
    path,
    await convertAudioFile(path, options.directory ?? "./outform-downloads", options.logger, options),
  );
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
