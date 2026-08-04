import { describe, expect, it } from "vitest";
import type { SelectedSourcePayload } from "./import-controller";
import { MemoryReviewService } from "./in-memory-import-controller";

const scannedPdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj <</Type /Page>> endobj\n%%EOF");

describe("MemoryReviewService PDF OCR orchestration", () => {
  it("runs injected local OCR when the PDF has no usable text layer", async () => {
    const ocrCalls: unknown[] = [];
    const service = new MemoryReviewService("00000000-0000-4000-8000-000000000001" as never, undefined, undefined, {
      async run(input) {
        ocrCalls.push(input);
        return {
          taskId: crypto.randomUUID(),
          pages: [{ page: 1, text: "2026-08-01 Synthetic shop -10.00 AED", confidence: 0.8 }],
        };
      },
    });
    const source: SelectedSourcePayload = {
      token: "x".repeat(32),
      displayName: "synthetic-scan.pdf",
      mimeType: "application/pdf",
      byteLength: scannedPdf.byteLength,
      bytes: scannedPdf,
      extension: ".pdf",
    };
    const draft = await service.start(source);
    expect(ocrCalls).toHaveLength(1);
    expect(draft.warnings).not.toContain("PDF_NEEDS_LOCAL_OCR");
    expect(draft.candidates).toHaveLength(1);
    expect(draft.candidates[0]?.description.provenance.source).toBe("ocr");
  });

  it("surfaces an actionable warning when no local OCR pipeline is configured", async () => {
    const service = new MemoryReviewService("00000000-0000-4000-8000-000000000002" as never);
    const source: SelectedSourcePayload = {
      token: "y".repeat(32),
      displayName: "synthetic-scan.pdf",
      mimeType: "application/pdf",
      byteLength: scannedPdf.byteLength,
      bytes: scannedPdf,
      extension: ".pdf",
    };
    const draft = await service.start(source);
    expect(draft.warnings).toContain("PDF_OCR_UNAVAILABLE");
    expect(draft.warnings).not.toContain("PDF_NEEDS_LOCAL_OCR");
    expect(draft.status).toBe("needs_ocr");
  });
});
