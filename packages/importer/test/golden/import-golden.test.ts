import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CanonicalCsvParser } from "../../src/csv/canonical-csv-parser";
import { normalizeCandidate } from "../../src/normalize/normalize-candidate";
import { reconcileStatement } from "../../src/reconcile/reconcile-statement";

describe("sanitized import golden", () => {
  it("keeps bilingual rows stable from parse through reconciliation", async () => {
    const bytes = await readFile(new URL("../fixtures/golden/canonical-zh-en.csv", import.meta.url));
    const parsed = await new CanonicalCsvParser().parse({ sourceDocumentId: crypto.randomUUID(), mimeType: "text/csv", extension: ".csv", prefix: bytes.subarray(0, 64), bytes, signal: new AbortController().signal });
    const candidates = parsed.candidates.map(normalizeCandidate);
    expect(candidates.map((item) => [item.transactionDate.value, item.normalizedDescription.value, item.amountMinor.value])).toMatchSnapshot();
    expect(reconcileStatement({ openingBalanceMinor: "100000", closingBalanceMinor: "108701", candidates, skips: [], expectedRecordCount: 2, expectedPageCount: 1, parsedPageCount: 1 }).status).toBe("balanced");
  });
});
