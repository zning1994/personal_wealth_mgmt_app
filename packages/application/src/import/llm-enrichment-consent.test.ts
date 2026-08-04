import { describe, expect, it } from "vitest";
import { approveTransmission } from "@pwm/ai";
import type { ImportCandidateV1 } from "@pwm/contracts";
import { previewImportTransmission, suggestCandidateCategoriesWithConsent } from "./llm-enrichment";

const candidate = { schemaVersion: 1 as const, rawRecordId: "018f4f7e-8ead-7c0d-8000-000000000001", transactionDate: { value: "2026-08-05", confidence: 1, provenance: { source: "row" as const, locator: "row:2", producerId: "synthetic", producerVersion: "1" } }, description: { value: "Synthetic Market", confidence: 1, provenance: { source: "row" as const, locator: "row:2", producerId: "synthetic", producerVersion: "1" } }, amountMinor: { value: "-100", confidence: 1, provenance: { source: "row" as const, locator: "row:2", producerId: "synthetic", producerVersion: "1" } }, currency: { value: "AED", confidence: 1, provenance: { source: "row" as const, locator: "row:2", producerId: "synthetic", producerVersion: "1" } }, direction: { value: "debit" as const, confidence: 1, provenance: { source: "row" as const, locator: "row:2", producerId: "synthetic", producerVersion: "1" } } } as unknown as ImportCandidateV1;

describe("import AI consent", () => {
  it("requires an approval bound to the exact redacted batch text", async () => {
    const preview = previewImportTransmission({ providerId: "ollama", providerName: "Ollama", baseUrl: "http://127.0.0.1:11434/api/chat", model: "llama3", candidates: [candidate] });
    const approval = approveTransmission(preview, "2026-08-05T00:00:00.000Z");
    const client = { analyze: async () => ({ suggestions: [{ rawRecordId: candidate.rawRecordId, categoryAccountId: null, confidence: 0.2, explanation: "uncertain" }] }) };
    await expect(suggestCandidateCategoriesWithConsent(client, [candidate], preview, approval)).resolves.toHaveLength(1);
  });
});
