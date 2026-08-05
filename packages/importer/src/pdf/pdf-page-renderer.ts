/**
 * The importer owns the serialisable contract for rendering PDF pages.  The
 * actual renderer lives in the desktop adapter because it needs an external
 * process (currently `pdftoppm`) and filesystem access.
 */
export type PdfPageRenderLimits = {
  readonly maxBytes: number;
  readonly maxPages: number;
  readonly maxPixelsPerPage: number;
  readonly timeoutMs: number;
  readonly dpi: number;
  readonly maxOutputBytesPerPage: number;
};

export type PdfPageRenderInput = {
  readonly bytes: Uint8Array;
  readonly pageCount: number;
  readonly pageNumbers: readonly number[];
  readonly outputDirectory: string;
  readonly signal: AbortSignal;
  readonly limits: PdfPageRenderLimits;
};

export type RenderedPdfPage = {
  readonly page: number;
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
};

export interface PdfPageRenderer {
  render(input: PdfPageRenderInput): Promise<readonly RenderedPdfPage[]>;
}

export type PdfPageRendererErrorCode =
  | "PDF_RENDERER_UNAVAILABLE"
  | "PDF_RENDERER_FAILED"
  | "PDF_RENDERER_TIMEOUT"
  | "PDF_RENDERER_CANCELLED"
  | "PDF_RENDERER_LIMIT_EXCEEDED"
  | "PDF_RENDERER_INVALID_PAGE"
  | "PDF_RENDERER_PATH_SCOPE_MISMATCH"
  | "PDF_RENDERER_PAGE_SELECTION_INVALID"
  | "PDF_RENDERER_PAGE_MISSING";

export class PdfPageRendererError extends Error {
  constructor(
    public readonly code: PdfPageRendererErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "PdfPageRendererError";
  }
}

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Read the dimensions from a PNG IHDR without decoding untrusted image data.
 * This is deliberately small: the OCR engine does the actual image decode,
 * while this boundary only needs dimensions for the pixel budget.
 */
export function readPngDimensions(bytes: Uint8Array): {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
} {
  if (bytes.byteLength < 24) {
    throw new PdfPageRendererError("PDF_RENDERER_INVALID_PAGE");
  }
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      throw new PdfPageRendererError("PDF_RENDERER_INVALID_PAGE");
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkLength = view.getUint32(8);
  const chunkType = String.fromCharCode(
    view.getUint8(12),
    view.getUint8(13),
    view.getUint8(14),
    view.getUint8(15),
  );
  if (chunkLength < 8 || chunkType !== "IHDR") {
    throw new PdfPageRendererError("PDF_RENDERER_INVALID_PAGE");
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1 || width > 100_000 || height > 100_000) {
    throw new PdfPageRendererError("PDF_RENDERER_INVALID_PAGE");
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels)) {
    throw new PdfPageRendererError("PDF_RENDERER_INVALID_PAGE");
  }
  return { width, height, pixels };
}
