import { inflateRawSync } from "node:zlib";
import { parseImportCandidate, type MappingProfile } from "@pwm/contracts";
import { decimalToMinor } from "../csv/canonical-csv-parser";
import type { ParserInput, ParserResult } from "../plugins/parser-plugin";

export type ExcelImportErrorCode = "MACRO_WORKBOOK_REJECTED" | "FORMULA_WITHOUT_SAVED_VALUE" | "WORKBOOK_LIMIT_EXCEEDED" | "INVALID_WORKBOOK";
export class ExcelImportError extends Error { constructor(public readonly code: ExcelImportErrorCode) { super(code); this.name = "ExcelImportError"; } }

type ZipEntry = { name: string; bytes: Uint8Array };
function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const entries: ZipEntry[] = [];
  for (let offset = 0; offset + 30 <= bytes.byteLength;) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true); const compressedSize = view.getUint32(offset + 18, true); const nameLength = view.getUint16(offset + 26, true); const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength)); const start = offset + 30 + nameLength + extraLength; const compressed = bytes.subarray(start, start + compressedSize);
    if (start + compressedSize > bytes.byteLength) throw new ExcelImportError("INVALID_WORKBOOK");
    let content: Uint8Array; try { content = method === 0 ? compressed : method === 8 ? new Uint8Array(inflateRawSync(compressed)) : (() => { throw new ExcelImportError("INVALID_WORKBOOK"); })(); } catch (error) { if (error instanceof ExcelImportError) throw error; throw new ExcelImportError("INVALID_WORKBOOK"); }
    entries.push({ name, bytes: content }); offset = start + compressedSize;
  }
  if (entries.length === 0) throw new ExcelImportError("INVALID_WORKBOOK");
  return entries;
}
function xmlText(value: string): string { return value.replace(/<[^>]+>/gu, "").replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/&#39;/gu, "'"); }
function columnIndex(reference: string): number { const letters = reference.match(/^[A-Z]+/iu)?.[0]?.toUpperCase() ?? "A"; let index = 0; for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64; return index - 1; }
function parseWorkbook(bytes: Uint8Array, limits: { maxRows: number; maxColumns: number }): string[][] {
  const entries = readZipEntries(bytes); if (entries.some((entry) => /vbaProject\.bin$/iu.test(entry.name))) throw new ExcelImportError("MACRO_WORKBOOK_REJECTED");
  const byName = new Map(entries.map((entry) => [entry.name, new TextDecoder().decode(entry.bytes)])); const shared = (byName.get("xl/sharedStrings.xml")?.match(/<si[\s\S]*?<\/si>/gu) ?? []).map(xmlText);
  const sheet = [...byName.entries()].find(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/iu.test(name)); if (!sheet) throw new ExcelImportError("INVALID_WORKBOOK");
  const rows: string[][] = [];
  for (const rowXml of sheet[1].match(/<row\b[\s\S]*?<\/row>/gu) ?? []) {
    const row: string[] = []; for (const cell of rowXml.match(/<c\b[\s\S]*?<\/c>/gu) ?? []) {
      const ref = cell.match(/\br="([A-Z]+\d+)"/iu)?.[1] ?? "A1"; const index = columnIndex(ref); const type = cell.match(/\bt="([^"]+)"/iu)?.[1]; const formula = /<f(?:\s[^>]*)?>[\s\S]*?<\/f>/iu.test(cell); const valueMatch = cell.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/iu); const inline = cell.match(/<is[\s\S]*?<\/is>/iu);
      if (formula && !valueMatch) throw new ExcelImportError("FORMULA_WITHOUT_SAVED_VALUE");
      let value = valueMatch?.[1] ?? (inline ? xmlText(inline[0]) : ""); if (type === "s") value = shared[Number(value)] ?? ""; if (type === "inlineStr") value = inline ? xmlText(inline[0]) : "";
      row[index] = value;
    }
    rows.push(row.map((value) => value ?? "")); if (rows.length > limits.maxRows) throw new ExcelImportError("WORKBOOK_LIMIT_EXCEEDED"); if (row.length > limits.maxColumns) throw new ExcelImportError("WORKBOOK_LIMIT_EXCEEDED");
  }
  return rows;
}
function dateValue(value: string, format: MappingProfile["dateFormat"]): string { if (format === "yyyy-MM-dd") return value; const [first, second, year] = value.split(/[-/]/u); if (!first || !second || !year) throw new ExcelImportError("INVALID_WORKBOOK"); return `${year}-${format === "dd/MM/yyyy" ? second : first}-${format === "dd/MM/yyyy" ? first : second}`; }

export async function parseSavedValueWorkbook(input: ParserInput, profile: MappingProfile): Promise<ParserResult> {
  if (input.extension.toLowerCase() !== ".xlsx" || /macroEnabled/iu.test(input.mimeType)) throw new ExcelImportError("MACRO_WORKBOOK_REJECTED");
  if (input.bytes.byteLength > 25 * 1024 * 1024) throw new ExcelImportError("WORKBOOK_LIMIT_EXCEEDED"); input.signal.throwIfAborted();
  const rows = parseWorkbook(input.bytes, { maxRows: 100_000, maxColumns: 128 }); const headers = rows.shift() ?? []; const mapped = rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  const columns = profile.columns; const candidates = mapped.map((row, index) => { const debit = columns.debit ? row[columns.debit] ?? "" : ""; const credit = columns.credit ? row[columns.credit] ?? "" : ""; const raw = columns.amount ? row[columns.amount] ?? "" : debit || credit; const amount = decimalToMinor(profile.decimalSeparator === "," ? raw.replaceAll(".", "").replace(",", ".") : raw); const direction = debit || amount < 0n ? "debit" : "credit"; const signed = (amount < 0n ? -amount : amount) * (direction === "debit" ? -1n : 1n); const provenance = { source: "row" as const, locator: `row:${index + 2}`, producerId: "saved-values-xlsx", producerVersion: "1.0.0" }; const date = dateValue(row[columns.date] ?? "", profile.dateFormat); return parseImportCandidate({ schemaVersion: 1, rawRecordId: crypto.randomUUID(), transactionDate: { value: date, confidence: 1, provenance }, description: { value: row[columns.description] ?? "", confidence: 1, provenance }, amountMinor: { value: signed.toString(), confidence: 1, provenance }, currency: { value: (row[columns.currency] ?? "").toUpperCase(), confidence: 1, provenance }, direction: { value: direction, confidence: 1, provenance } }); });
  return { candidates, warnings: [] };
}
