import { describe, test, expect } from "bun:test";
import { extractPdf } from "../../src/extractors/pdf";

describe("extractPdf", () => {
  test("extracts text from a real PDF (arxiv)", async () => {
    const result = await extractPdf("https://arxiv.org/pdf/2301.00001v1.pdf");

    expect(result.title).toBeTruthy();
    expect(result.source).toBe("https://arxiv.org/pdf/2301.00001v1.pdf");
    expect(result.content.length).toBeGreaterThan(100);
    expect(result.pageCount).toBeGreaterThan(0);
  }, 30_000);

  test("throws on non-existent URL", async () => {
    await expect(extractPdf("https://example.com/nonexistent.pdf")).rejects.toThrow();
  });

  test("throws friendly error for unresolvable hostname", async () => {
    await expect(extractPdf("https://this-domain-does-not-exist-zzz.invalid/doc.pdf")).rejects.toThrow(
      /Could not resolve hostname/,
    );
  });

  test("returns structured PdfResult", async () => {
    const result = await extractPdf("https://arxiv.org/pdf/2301.00001v1.pdf");

    expect(result).toHaveProperty("title");
    expect(result).toHaveProperty("pageCount");
    expect(result).toHaveProperty("source");
    expect(result).toHaveProperty("content");
    expect(typeof result.title).toBe("string");
    expect(typeof result.pageCount).toBe("number");
    expect(typeof result.content).toBe("string");
  }, 30_000);
});
