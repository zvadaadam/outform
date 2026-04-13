import { PDFParse } from "pdf-parse";
import { logProgress } from "../utils/log";
import { spin } from "../utils/spinner";

export interface PdfResult {
  title: string;
  pageCount: number;
  source: string;
  content: string;
}

export async function extractPdf(url: string): Promise<PdfResult> {
  const s = spin("Downloading PDF...");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/pdf,*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e: any) {
    s.stop("Download failed");
    throw new Error(friendlyFetchError(url, e));
  }

  if (!response.ok) {
    s.stop("Download failed");
    throw new Error(
      `Failed to fetch PDF ${url}: ${response.status} ${response.statusText}`
    );
  }

  const contentType = response.headers.get("content-type") || "";
  if (
    !contentType.includes("pdf") &&
    !contentType.includes("octet-stream") &&
    !url.toLowerCase().endsWith(".pdf")
  ) {
    s.stop("Not a PDF");
    throw new Error(
      `URL does not appear to be a PDF. Content-Type: ${contentType}`
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    s.stop("Empty file");
    throw new Error("PDF file is empty.");
  }

  s.stop("PDF downloaded");
  logProgress("Extracting text from PDF...");

  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const textResult = await parser.getText();
  const infoResult = await parser.getInfo();
  await parser.destroy();

  const content = textResult.text.trim();

  if (!content) {
    throw new Error(
      "Could not extract text from PDF. The file may be scanned/image-based."
    );
  }

  const title =
    infoResult.info?.Title || filenameFromUrl(url) || "Untitled PDF";

  return {
    title,
    pageCount: textResult.total,
    source: url,
    content,
  };
}

function filenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split("/").pop() || "";
    return filename.replace(/\.pdf$/i, "").replace(/[-_]/g, " ");
  } catch {
    return "";
  }
}

function friendlyFetchError(url: string, e: Error): string {
  const msg = e.message || "";
  if (e.name === "TimeoutError" || msg.includes("abort")) {
    return `Request to ${url} timed out after 60 seconds. The PDF may be very large or the server slow.`;
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
  return `Failed to download PDF from ${url}: ${msg || "network error"}`;
}
