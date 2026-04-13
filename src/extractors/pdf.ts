import { PDFParse } from "pdf-parse";
import { logProgress } from "../utils/log";

export interface PdfResult {
  title: string;
  pageCount: number;
  source: string;
  content: string;
}

export async function extractPdf(url: string): Promise<PdfResult> {
  logProgress("Downloading PDF...");

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/pdf,*/*",
    },
    redirect: "follow",
  });

  if (!response.ok) {
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
    throw new Error(
      `URL does not appear to be a PDF. Content-Type: ${contentType}`
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error("PDF file is empty.");
  }

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
