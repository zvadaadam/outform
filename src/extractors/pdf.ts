import { logProgress, type ExtractLogger } from "../utils/log";
import { spin } from "../utils/spinner";
import { friendlyFetchError } from "../utils/fetch-error";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { isValidUrl } from "../utils/url";

type PDFParseConstructor = typeof import("pdf-parse")["PDFParse"];

let pdfRuntime: Promise<PDFParseConstructor> | undefined;

class TextOnlyDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(values?: number[]) {
    if (values?.length === 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = values as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
    }
  }
}

class TextOnlyImageData {}
class TextOnlyPath2D {}

function installTextOnlyPdfGlobals(): void {
  const globals = globalThis as Record<string, unknown>;
  globals.DOMMatrix ??= TextOnlyDOMMatrix;
  globals.ImageData ??= TextOnlyImageData;
  globals.Path2D ??= TextOnlyPath2D;
}

async function loadPdfRuntime(): Promise<PDFParseConstructor> {
  pdfRuntime ??= (async () => {
    installTextOnlyPdfGlobals();

    // pdf.js probes an optional canvas package while loading. Outform only uses
    // text extraction, so the missing rendering dependency is expected.
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (String(args[0]).includes('Cannot load "@napi-rs/canvas"')) return;
      warn(...args);
    };

    try {
      const { PDFParse } = await import("pdf-parse");

      // Bun executables cannot resolve pdf.js's adjacent worker file from the
      // embedded filesystem. Embed the worker as a data URL only in that case;
      // regular Node/Bun installs can use pdf.js's normal file resolution.
      const isBunExecutable =
        "bun" in process.versions &&
        !/(^|[/\\])bun(?:\.exe)?$/i.test(process.execPath);
      if (isBunExecutable) {
        const { getData } = await import("pdf-parse/worker");
        PDFParse.setWorker(getData());
      }
      return PDFParse;
    } finally {
      console.warn = warn;
    }
  })();

  return pdfRuntime;
}

export interface PdfResult {
  title: string;
  pageCount: number;
  source: string;
  content: string;
}

export async function extractPdf(
  source: string,
  logger?: ExtractLogger,
): Promise<PdfResult> {
  const remote = isValidUrl(source);
  const s = spin(remote ? "Downloading PDF..." : "Reading PDF...", logger);

  let buffer: ArrayBuffer;
  if (remote) {
    let response: Response;
    try {
      response = await fetch(source, {
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
      throw new Error(friendlyFetchError(source, e, "download PDF from"));
    }

    if (!response.ok) {
      s.stop("Download failed");
      throw new Error(`Failed to fetch PDF ${source}: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (
      !contentType.includes("pdf") &&
      !contentType.includes("octet-stream") &&
      !source.toLowerCase().endsWith(".pdf")
    ) {
      s.stop("Not a PDF");
      throw new Error(`URL does not appear to be a PDF. Content-Type: ${contentType}`);
    }

    buffer = await response.arrayBuffer();
  } else {
    const file = await readFile(source);
    buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  }

  if (buffer.byteLength === 0) {
    s.stop("Empty file");
    throw new Error("PDF file is empty.");
  }

  s.stop(remote ? "PDF downloaded" : "PDF read");
  logProgress("Extracting text from PDF...", logger);

  const PDFParse = await loadPdfRuntime();
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const textResult = await parser.getText();
  const infoResult = await parser.getInfo();
  await parser.destroy();

  const content = textResult.text.trim();

  if (!content) {
    throw new Error(
      "Could not extract text from PDF. The file may be scanned/image-based.",
    );
  }

  const title = infoResult.info?.Title || filenameFromSource(source) || "Untitled PDF";
  const normalizedSource = remote ? source : resolve(source);

  return {
    title,
    pageCount: textResult.total,
    source: normalizedSource,
    content,
  };
}

function filenameFromSource(source: string): string {
  try {
    const filename = isValidUrl(source)
      ? new URL(source).pathname.split("/").pop() || ""
      : basename(source);
    return filename.replace(/\.pdf$/i, "").replace(/[-_]/g, " ");
  } catch {
    return "";
  }
}
