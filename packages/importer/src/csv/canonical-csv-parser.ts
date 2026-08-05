import { randomUUID } from "node:crypto";
import { parseImportCandidate } from "@pwm/contracts";
import type { ParserInput, ParserPlugin, ParserResult } from "../plugins/parser-plugin";

export function decimalToMinor(value: string): bigint {
  const normalized = value.trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/u.test(normalized)) throw new Error("INVALID_DECIMAL_AMOUNT");
  const negative = normalized.startsWith("-"); const [whole = "0", fractional = ""] = normalized.replace(/^-/, "").split(".");
  const minor = BigInt(whole) * 100n + BigInt(fractional.padEnd(2, "0")); return negative ? -minor : minor;
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) { const char = text[index]!;
    if (char === '"') { if (quoted && text[index + 1] === '"') { cell += char; index += 1; } else quoted = !quoted; }
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[index + 1] === "\n") index += 1; row.push(cell); if (row.some((item) => item.length > 0)) rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new Error("INVALID_CSV_QUOTING"); if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  const [headers, ...values] = rows; if (!headers) return [];
  return values.map((valuesRow) => Object.fromEntries(headers.map((header, index) => [header.replace(/^\uFEFF/u, "").trim(), valuesRow[index]?.trim() ?? ""])));
}

export class CanonicalCsvParser implements ParserPlugin {
  readonly id = "canonical-csv"; readonly version = "1.0.0"; readonly priority = 100;
  canParse(input: { mimeType: string; extension: string }): boolean { return input.mimeType === "text/csv" || input.extension.toLowerCase() === ".csv"; }
  async parse(input: ParserInput): Promise<ParserResult> {
    input.signal.throwIfAborted();
    const candidates = parseCsv(new TextDecoder().decode(input.bytes)).map((row, index) => {
      const provenance = { source: "row" as const, locator: `row:${index + 2}`, producerId: this.id, producerVersion: this.version };
      const parsed = decimalToMinor(row.amount ?? ""); const amountMinor = (parsed < 0n ? -parsed : parsed) * (row.direction === "debit" ? -1n : 1n);
      return parseImportCandidate({ schemaVersion: 1, rawRecordId: randomUUID(), transactionDate: { value: row.date, confidence: 1, provenance }, description: { value: row.description, confidence: 1, provenance }, amountMinor: { value: amountMinor.toString(), confidence: 1, provenance }, currency: { value: (row.currency ?? "").toUpperCase(), confidence: 1, provenance }, direction: { value: row.direction, confidence: 1, provenance }, ...(row.balance ? { balanceMinor: { value: decimalToMinor(row.balance).toString(), confidence: 1, provenance } } : {}) });
    });
    return { candidates, warnings: [] };
  }
}
