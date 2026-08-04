import { describe, expect, it, vi } from "vitest";
import { registerLlmAnalysisIpc } from "./llm-analysis-ipc";

describe("LLM import consent IPC", () => {
  it("returns a preview before the provider client can analyze", async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    const service = { client: vi.fn(async () => ({ providerName: "Ollama", baseUrl: "http://127.0.0.1:11434/api/chat", model: "llama3", client: { analyze: vi.fn() } })) };
    registerLlmAnalysisIpc({ handle: (channel, handler) => handlers.set(channel, handler), removeHandler: vi.fn() }, service as never);
    const candidate = { schemaVersion: 1, rawRecordId: "018f4f7e-8ead-7c0d-8000-000000000001", transactionDate: { value: "2026-08-05", confidence: 1, provenance: { source: "row", locator: "row:2", producerId: "synthetic", producerVersion: "1" } }, description: { value: "Synthetic", confidence: 1, provenance: { source: "row", locator: "row:2", producerId: "synthetic", producerVersion: "1" } }, amountMinor: { value: "-100", confidence: 1, provenance: { source: "row", locator: "row:2", producerId: "synthetic", producerVersion: "1" } }, currency: { value: "AED", confidence: 1, provenance: { source: "row", locator: "row:2", producerId: "synthetic", producerVersion: "1" } }, direction: { value: "debit", confidence: 1, provenance: { source: "row", locator: "row:2", producerId: "synthetic", producerVersion: "1" } } };
    await expect(handlers.get("llm:preview-import")?.({}, { provider: "ollama", candidates: [candidate] })).resolves.toMatchObject({ risks: ["REMOTE_PROVIDER_RECEIVES_FINANCIAL_TEXT"] });
  });
});
