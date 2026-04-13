import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { logProgress, logError } from "../utils/log";

export interface WebResult {
  title: string;
  author: string | null;
  source: string;
  content: string;
  textContent: string;
  excerpt: string | null;
}

export async function extractWeb(url: string): Promise<WebResult> {
  logProgress("Fetching page...");

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
    throw new Error(friendlyFetchError(url, e));
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`
    );
  }

  const html = await response.text();
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

function friendlyFetchError(url: string, e: Error): string {
  const msg = e.message || "";
  if (e.name === "TimeoutError" || msg.includes("abort")) {
    return `Request to ${url} timed out after 30 seconds. Check your network connection or try again.`;
  }
  if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo") || msg.includes("typo in the url")) {
    return `Could not resolve hostname for ${url}. Check the URL and your network connection.`;
  }
  if (msg.includes("ECONNREFUSED") || msg.includes("Unable to connect")) {
    return `Connection refused by ${url}. The server may be down or the URL may be wrong.`;
  }
  if (msg.includes("CERT") || msg.includes("SSL") || msg.includes("TLS")) {
    return `TLS/SSL error connecting to ${url}. The site may have certificate issues.`;
  }
  return `Failed to fetch ${url}: ${msg || "network error"}`;
}
