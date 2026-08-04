import { describe, expect, it } from "vitest";
import { parseImportCandidate } from "./candidate.js";

const provenance = {
  source: "row",
  locator: "row:2",
  producerId: "canonical-csv",
  producerVersion: "1.0.0",
  evidence: "2026-08-01",
};

describe("parseImportCandidate", () => {
  it("accepts a versioned CJK candidate and preserves field provenance", () => {
    const candidate = parseImportCandidate({
      schemaVersion: 1,
      rawRecordId: "018f8f19-2d6a-7b00-8000-000000000001",
      transactionDate: { value: "2026-08-01", confidence: 0.99, provenance },
      description: { value: "合成超市", confidence: 0.8, provenance },
      amountMinor: { value: "-1299", confidence: 1, provenance },
      currency: { value: "AED", confidence: 1, provenance },
      direction: { value: "debit", confidence: 1, provenance },
    });
    expect(candidate.description.value).toBe("合成超市");
    expect(candidate.amountMinor.provenance.locator).toBe("row:2");
  });

  it("rejects unknown versions and out-of-range confidence", () => {
    expect(() => parseImportCandidate({ schemaVersion: 2 })).toThrow();
    expect(() => parseImportCandidate({ schemaVersion: 1, rawRecordId: crypto.randomUUID(), confidence: 1.1 })).toThrow();
  });
});
