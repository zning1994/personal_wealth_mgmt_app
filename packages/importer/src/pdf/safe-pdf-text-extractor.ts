export type PdfTextInput = { bytes: Uint8Array; signal: AbortSignal; limits: { maxBytes: number; maxPages: number; timeoutMs: number } };
export type PdfTextResult = { pageCount: number; pages: Array<{ page: number; text: string }>; needsOcr: boolean };
export type PdfSafetyErrorCode = "PDF_LIMIT_EXCEEDED" | "PDF_ATTACHMENT_REJECTED" | "PDF_EXTERNAL_LINK_REJECTED" | "PDF_TIMEOUT" | "PDF_INVALID";
export class PdfSafetyError extends Error { constructor(public readonly code: PdfSafetyErrorCode) { super(code); this.name = "PdfSafetyError"; } }
function decodeLiteral(value: string): string { return value.replace(/\\([\\()nrt])/gu, (_match, code: string) => ({ n: "\n", r: "\r", t: "\t" }[code] ?? code)); }
export async function extractPdfText(input: PdfTextInput): Promise<PdfTextResult> {
  if (input.bytes.byteLength > input.limits.maxBytes) throw new PdfSafetyError("PDF_LIMIT_EXCEEDED"); input.signal.throwIfAborted();
  const text = new TextDecoder("utf-8", { fatal: false }).decode(input.bytes); if (!text.startsWith("%PDF-")) throw new PdfSafetyError("PDF_INVALID");
  if (/\/JavaScript\b|\/JS\b|\/EmbeddedFile\b|\/Filespec\b|\/Launch\b/iu.test(text)) throw new PdfSafetyError("PDF_ATTACHMENT_REJECTED"); if (/\/URI\b/iu.test(text)) throw new PdfSafetyError("PDF_EXTERNAL_LINK_REJECTED");
  const pages = Math.max(1, (text.match(/\/Type\s*\/Page\b/gu) ?? []).length); if (pages > input.limits.maxPages) throw new PdfSafetyError("PDF_LIMIT_EXCEEDED");
  const strings: string[] = []; for (const match of text.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/gu)) strings.push(decodeLiteral(match[1] ?? "")); for (const match of text.matchAll(/\[((?:.|\n)*?)\]\s*TJ/gu)) for (const literal of (match[1] ?? "").matchAll(/\(((?:\\.|[^\\)])*)\)/gu)) strings.push(decodeLiteral(literal[1] ?? ""));
  const pageText = strings.join(" ").normalize("NFKC").trim(); return { pageCount: pages, pages: Array.from({ length: pages }, (_value, index) => ({ page: index + 1, text: index === 0 ? pageText : "" })), needsOcr: pageText.length < 20 };
}
