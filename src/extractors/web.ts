import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { logProgress } from "../utils/log";
import { spin } from "../utils/spinner";
import { friendlyFetchError } from "../utils/fetch-error";

export interface WebResult {
  title: string;
  author: string | null;
  source: string;
  content: string;
  textContent: string;
  excerpt: string | null;
}

export async function extractWeb(url: string): Promise<WebResult> {
  const s = spin("Fetching page...");

  let response: Response;
  try {
    response = await fetch(url, {
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
    throw new Error(friendlyFetchError(url, e, "fetch"));
  }

  if (!response.ok) {
    s.stop("Fetch failed");
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`
    );
  }

  const html = await response.text();
  s.stop("Page fetched");
  logProgress("Parsing article content...");

  const { document } = parseHTML(html);
  const reader = new Readability(document as any);
  const article = reader.parse();

  if (!article || !article.content?.trim()) {
    throw new Error(
      `Could not extract readable content from ${url}. The page may be JavaScript-rendered or require authentication.`
    );
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  const markdown = turndown.turndown(article.content).trim();

  return {
    title: article.title || new URL(url).hostname,
    author: article.byline || null,
    source: url,
    content: markdown,
    textContent: (article.textContent ?? "").trim(),
    excerpt: article.excerpt || null,
  };
}
