import { describe, expect, it } from "vitest";
import { PdfPageRendererError, readPngDimensions } from "./pdf-page-renderer";

function syntheticPng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("readPngDimensions", () => {
  it("reads dimensions without decoding the image", () => {
    expect(readPngDimensions(syntheticPng(1200, 800))).toEqual({
      width: 1200,
      height: 800,
      pixels: 960_000,
    });
  });

  it("rejects malformed or implausibly large pages", () => {
    expect(() => readPngDimensions(new Uint8Array(2))).toThrowError(
      new PdfPageRendererError("PDF_RENDERER_INVALID_PAGE"),
    );
    expect(() => readPngDimensions(syntheticPng(100_001, 1))).toThrow(
      "PDF_RENDERER_INVALID_PAGE",
    );
  });
});
