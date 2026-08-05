import { describe, expect, it, vi } from "vitest";
import type { ImportCandidateV1 } from "@pwm/contracts";
import { suggestCandidateCategories } from "./llm-enrichment";

const candidate = { schemaVersion: 1, rawRecordId: "00000000-0000-4000-8000-000000000001", transactionDate: { value: "2026-08-04", confidence: 1, provenance: { source: "row", locator: "row:1", producerId: "test", producerVersion: "1" } }, description: { value: "Grocery", confidence: 1, provenance: { source: "row", locator: "row:1", producerId: "test", producerVersion: "1" } }, amountMinor: { value: "-1200", confidence: 1, provenance: { source: "row", locator: "row:1", producerId: "test", producerVersion: "1" } }, currency: { value: "AED", confidence: 1, provenance: { source: "row", locator: "row:1", producerId: "test", producerVersion: "1" } }, direction: { value: "debit", confidence: 1, provenance: { source: "row", locator: "row:1", producerId: "test", producerVersion: "1" } } } as ImportCandidateV1;

describe("suggestCandidateCategories", () => {
  it("keeps the model suggestion separate from the candidate and requires a validated response", async () => {
    const analyze = vi.fn(async () => ({ categoryAccountId: "00000000-0000-4000-8000-000000000099", confidence: 0.8, explanation: "Food purchase" }));
    await expect(suggestCandidateCategories({ analyze }, [candidate])).resolves.toEqual([{ rawRecordId: candidate.rawRecordId, categoryAccountId: "00000000-0000-4000-8000-000000000099", confidence: 0.8, explanation: "Food purchase" }]);
    expect(analyze).toHaveBeenCalledOnce();
  });
});
