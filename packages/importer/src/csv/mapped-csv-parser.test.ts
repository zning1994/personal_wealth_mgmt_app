import { describe, expect, it } from "vitest";
import { MappedCsvParser } from "./mapped-csv-parser.js";
describe("MappedCsvParser", () => it("applies an explicit profile without guessing ambiguous columns", async () => {
  const bytes = new TextEncoder().encode("交易日,摘要,支出,收入,币种,余额\n03/08/2026,合成咖啡,8.50,,AED,991.50");
  const result = await new MappedCsvParser({ id: crypto.randomUUID(), workspaceId: "018f8f19-2d6a-7b00-8000-000000000099" as never, name: "Synthetic", sourceFingerprint: "fixture", columns: { date: "交易日", description: "摘要", debit: "支出", credit: "收入", currency: "币种", balance: "余额" }, dateFormat: "dd/MM/yyyy", decimalSeparator: "." }).parse({ sourceDocumentId: crypto.randomUUID(), mimeType: "text/csv", extension: ".csv", prefix: bytes, bytes, signal: new AbortController().signal });
  expect(result.candidates[0]).toMatchObject({ transactionDate: { value: "2026-08-03" }, amountMinor: { value: "-850" }, direction: { value: "debit" } });
}));
