import { mkdir } from "fs/promises";
import { extractDomain, hashString } from "../utils/url";
import type { WebResult } from "../extractors/web";

const OUTPUT_DIR = "/tmp/extractor";

export function formatWebMarkdown(result: WebResult): string {
  const lines: string[] = [];

  lines.push(`# ${result.title}`);
  lines.push("");

  if (result.author) {
    lines.push(`**Author:** ${result.author}`);
  }
  lines.push(`**Source:** ${result.source}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Content");
  lines.push("");
  lines.push(result.content);
  lines.push("");

  return lines.join("\n");
}

export function formatWebText(result: WebResult): string {
  const lines: string[] = [];

  lines.push(result.title);
  lines.push("=".repeat(result.title.length));
  lines.push("");
  if (result.author) lines.push(`Author: ${result.author}`);
  lines.push(`Source: ${result.source}`);
  lines.push("");
  lines.push(result.content);
  lines.push("");

  return lines.join("\n");
}

export function formatWebJson(result: WebResult): string {
  return JSON.stringify(
    {
      type: "web",
      title: result.title,
      author: result.author,
      source: result.source,
      excerpt: result.excerpt,
      content: result.content,
    },
    null,
    2
  );
}

export function getWebOutputPath(url: string): string {
  const domain = extractDomain(url);
  const hash = hashString(url);
  return `${OUTPUT_DIR}/web-${domain}-${hash}.md`;
}

export async function writeOutput(
  filePath: string,
  content: string
): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await Bun.write(filePath, content);
}
