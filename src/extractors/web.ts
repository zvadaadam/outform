import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { logProgress, logError } from "../utils/log";

export interface WebResult {
  title: string;
  author: string | null;
  source: string;
  content: string;
  excerpt: string | null;
}

export async function extractWeb(url: string): Promise<WebResult> {
  logProgress("Fetching page...");

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

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

  if (!article || !article.textContent?.trim()) {
    throw new Error(
      `Could not extract readable content from ${url}. The page may be JavaScript-rendered or require authentication.`
    );
  }

  return {
    title: article.title || new URL(url).hostname,
    author: article.byline || null,
    source: url,
    content: article.textContent.trim(),
    excerpt: article.excerpt || null,
  };
}
