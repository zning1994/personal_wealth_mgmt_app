import { describe, expect, it, vi } from "vitest";
import { registerLlmAnalysisIpc } from "./llm-analysis-ipc";

describe("LLM import consent IPC", () => {
  const candidate = { schemaVersion: 1, rawRecordId: "018f4f7e-8ead-7c0d-8000-000000000001", transactionDate: { value: "2026-08-05", confidence: 1, provenance: { source: "row", locator: "row:2", producerId: "synthetic", producerVersion: "1" } }, description: { value: "Synthetic", confidence: 1, provenance: { source: "row", locator: "row:2", producerId: "synthetic", producerVersion: "1" } }, amountMinor: { value: "-100", confidence: 1, provenance: { source: "row", locator: "row:2", producerId: "synthetic", producerVersion: "1" } }, currency: { value: "AED", confidence: 1, provenance: { source: "row", locator: "row:2", producerId: "synthetic", producerVersion: "1" } }, direction: { value: "debit", confidence: 1, provenance: { source: "row", locator: "row:2", producerId: "synthetic", producerVersion: "1" } } };
  it("returns a preview before the provider client can analyze", async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    const service = { client: vi.fn(async () => ({ providerName: "Ollama", baseUrl: "http://127.0.0.1:11434/api/chat", model: "llama3", client: { analyze: vi.fn() } })) };
    registerLlmAnalysisIpc({ handle: (channel, handler) => handlers.set(channel, handler), removeHandler: vi.fn() }, service as never);
    await expect(handlers.get("llm:preview-import")?.({}, { provider: "ollama", candidates: [candidate] })).resolves.toMatchObject({ risks: ["REMOTE_PROVIDER_RECEIVES_FINANCIAL_TEXT"] });
  });

  it("requires a provider-capable fallback and binds the preview to the capability token", async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    const service = { client: vi.fn(async () => ({ providerName: "OpenAI", baseUrl: "https://api.openai.com/v1/responses", model: "gpt-5-mini", client: { analyze: vi.fn() } })) };
    const fallback = {
      prepare: vi.fn(),
      resolve: vi.fn(async () => ({ batchId: "018f4f7e-8ead-7c0d-8000-000000000010", mode: "page_images", pages: [1], attachments: { images: [{ mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) }] } })),
    };
    registerLlmAnalysisIpc({ handle: (channel, handler) => handlers.set(channel, handler), removeHandler: vi.fn() }, service as never, fallback as never);
    await expect(handlers.get("llm:preview-import")?.({}, { provider: "openai", batchId: "018f4f7e-8ead-7c0d-8000-000000000010", fallbackToken: "t".repeat(32), candidates: [candidate] })).resolves.toMatchObject({ imageCount: 1 });
    expect(fallback.resolve).toHaveBeenCalledWith("t".repeat(32), "018f4f7e-8ead-7c0d-8000-000000000010");
  });
});
