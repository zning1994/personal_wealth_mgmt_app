import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseSavedValueWorkbook } from "./saved-values-parser";
import type { MappingProfile } from "@pwm/contracts";

function xlsxFixture(formulaWithoutValue = false): Uint8Array {
  const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c><c r="B1" t="inlineStr"><is><t>摘要</t></is></c><c r="C1" t="inlineStr"><is><t>Amount</t></is></c><c r="D1" t="inlineStr"><is><t>Currency</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>2026-08-03</t></is></c><c r="B2" t="inlineStr"><is><t>合成咖啡</t></is></c><c r="C2"><f>6.25*2</f>${formulaWithoutValue ? "" : "<v>12.5</v>"}</c><c r="D2" t="inlineStr"><is><t>AED</t></is></c></row></sheetData></worksheet>`;
  const entries = [["[Content_Types].xml", "<Types/>"] , ["xl/workbook.xml", "<workbook/>"] , ["xl/worksheets/sheet1.xml", sheet]];
  const chunks: Uint8Array[] = []; const enc = new TextEncoder();
  for (const [name, content] of entries) { const nameBytes = enc.encode(name); const data = enc.encode(content); const compressed = new Uint8Array(deflateRawSync(data)); const local = new Uint8Array(30 + nameBytes.length + compressed.length); const view = new DataView(local.buffer); view.setUint32(0, 0x04034b50, true); view.setUint16(8, 8, true); view.setUint32(18, compressed.length, true); view.setUint32(22, data.length, true); view.setUint16(26, nameBytes.length, true); local.set(nameBytes, 30); local.set(compressed, 30 + nameBytes.length); chunks.push(local); }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0); const result = new Uint8Array(total); let cursor = 0; for (const chunk of chunks) { result.set(chunk, cursor); cursor += chunk.length; } return result;
}
const profile: MappingProfile = { id: crypto.randomUUID(), workspaceId: "018f8f19-2d6a-7b00-0000-000000000099" as never, name: "Synthetic XLSX", sourceFingerprint: "fixture", columns: { date: "Date", description: "摘要", amount: "Amount", currency: "Currency" }, dateFormat: "yyyy-MM-dd", decimalSeparator: "." };
const input = (bytes: Uint8Array, extension = ".xlsx", mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") => ({ sourceDocumentId: crypto.randomUUID(), mimeType, extension, prefix: bytes.subarray(0, 64), bytes, signal: new AbortController().signal });
describe("saved-value Excel parser", () => {
  it("uses cached formula values and never evaluates formulas", async () => { await expect(parseSavedValueWorkbook(input(xlsxFixture()), profile)).resolves.toMatchObject({ candidates: [{ amountMinor: { value: "1250" } }] }); });
  it("rejects macros and formulas without saved values", async () => { await expect(parseSavedValueWorkbook(input(new Uint8Array(), ".xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"), profile)).rejects.toMatchObject({ code: "MACRO_WORKBOOK_REJECTED" }); await expect(parseSavedValueWorkbook(input(xlsxFixture(true)), profile)).rejects.toMatchObject({ code: "FORMULA_WITHOUT_SAVED_VALUE" }); });
});
