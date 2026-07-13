import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { logProgress, type ExtractLogger } from "../utils/log";
import { spin } from "../utils/spinner";
import { friendlyFetchError } from "../utils/fetch-error";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { isValidUrl } from "../utils/url";

export interface WebResult {
  title: string;
  author: string | null;
  source: string;
  content: string;
  textContent: string;
  excerpt: string | null;
}

export async function extractWeb(
  source: string,
  logger?: ExtractLogger,
): Promise<WebResult> {
  const remote = isValidUrl(source);
  const s = spin(remote ? "Fetching page..." : "Reading file...", logger);

  let content: string;
  let normalizedSource = source;
  if (remote) {
    let response: Response;
    try {
      response = await fetch(source, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e: any) {
      s.stop("Fetch failed");
      throw new Error(friendlyFetchError(source, e, "fetch"));
    }

    if (!response.ok) {
      s.stop("Fetch failed");
      throw new Error(`Failed to fetch ${source}: ${response.status} ${response.statusText}`);
    }

    content = await response.text();
  } else {
    content = await readFile(source, "utf8");
    normalizedSource = resolve(source);
  }

  s.stop(remote ? "Page fetched" : "File read");

  if (!remote && [".md", ".mdx", ".txt"].includes(extname(source).toLowerCase())) {
    const title = basename(source).replace(/\.(?:md|mdx|txt)$/i, "");
    return {
      title,
      author: null,
      source: normalizedSource,
      content: content.trim(),
      textContent: content.trim(),
      excerpt: null,
    };
  }

  logProgress("Parsing article content...", logger);

  const { document } = parseHTML(content);
  const reader = new Readability(document as any);
  const article = reader.parse();

  if (!article || !article.content?.trim()) {
    throw new Error(
      `Could not extract readable content from ${source}. The page may be JavaScript-rendered or require authentication.`,
    );
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  const markdown = turndown.turndown(article.content).trim();

  return {
    title: article.title || (remote ? new URL(source).hostname : basename(source)),
    author: article.byline || null,
    source: normalizedSource,
    content: markdown,
    textContent: (article.textContent ?? "").trim(),
    excerpt: article.excerpt || null,
  };
}
