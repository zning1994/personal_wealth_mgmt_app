import { describe, expect, it } from "vitest";
import { extractPdfText } from "./safe-pdf-text-extractor";
const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type /Page>>endobj\nBT (Synthetic Statement / 合成账单) Tj ET\n%%EOF");
describe("safe PDF text extraction", () => {
  it("extracts text without enabling scripts or links", async () => { await expect(extractPdfText({ bytes: pdf, signal: new AbortController().signal, limits: { maxBytes: 10_000, maxPages: 2, timeoutMs: 100 } })).resolves.toMatchObject({ pageCount: 1, needsOcr: false, pages: [{ text: "Synthetic Statement / 合成账单" }] }); });
  it("rejects oversized or active-content input before parsing", async () => { await expect(extractPdfText({ bytes: pdf, signal: new AbortController().signal, limits: { maxBytes: 1, maxPages: 1, timeoutMs: 100 } })).rejects.toMatchObject({ code: "PDF_LIMIT_EXCEEDED" }); const active = new TextEncoder().encode("%PDF-1.4 /JavaScript"); await expect(extractPdfText({ bytes: active, signal: new AbortController().signal, limits: { maxBytes: 1000, maxPages: 1, timeoutMs: 100 } })).rejects.toMatchObject({ code: "PDF_ATTACHMENT_REJECTED" }); });
});
