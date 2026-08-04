import { describe, expect, it, vi } from "vitest";
import { createLlmClient } from "../src";

const secretStore = { get: vi.fn(async () => "sk-test-secret") };
const response = (body: unknown) => ({ status: 200, headers: new Headers(), body });
const request = { task: "categorize-import" as const, instruction: "Classify this transaction", parts: [{ field: "description", text: "Grocery" }], responseSchema: { category: "string" } };

describe("LLM BYOK transport", () => {
  it("sends only extracted text to the OpenAI-compatible endpoint", async () => {
    const fetcher = vi.fn(async (_input: string | URL, init?: RequestInit) => { expect(String(init?.body)).toContain("Grocery"); expect(String(init?.body)).not.toContain("pdf-bytes"); return response({ choices: [{ message: { content: '{"category":"food"}' } }] }); });
    await expect(createLlmClient({ provider: "openai-compatible", model: "local-model", secretRef: "openai-key", enabled: true, endpoint: "http://localhost/v1/chat/completions" }, secretStore, fetcher).analyze(request)).resolves.toEqual({ category: "food" });
    expect(secretStore.get).toHaveBeenCalledWith("openai-key");
  });

  it("supports Anthropic, DeepSeek Responses and Ollama response envelopes", async () => {
    const cases = [
      [{ provider: "anthropic", model: "claude", secretRef: "a", enabled: true }, { content: [{ type: "text", text: '{"ok":true}' }] }],
      [{ provider: "deepseek-responses", model: "deepseek-v4-flash", secretRef: "d", enabled: true }, { output_text: '{"ok":true}' }],
      [{ provider: "ollama", model: "llama3", enabled: true }, { message: { content: '{"ok":true}' } }],
    ] as const;
    for (const [config, body] of cases) await expect(createLlmClient(config, secretStore, async () => response(body)).analyze(request)).resolves.toEqual({ ok: true });
  });

  it("uses the OpenAI Responses API with storage disabled", async () => {
    const fetcher = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.store).toBe(false);
      expect(body.input).toBeDefined();
      return response({ output_text: '{"ok":true}' });
    });
    await expect(createLlmClient({ provider: "openai", model: "gpt-5-mini", secretRef: "openai", enabled: true }, secretStore, fetcher).analyze(request)).resolves.toEqual({ ok: true });
  });

  it("fails closed when the provider returns non-JSON", async () => {
    await expect(createLlmClient({ provider: "ollama", model: "llama3", enabled: true }, secretStore, async () => response({ message: { content: "not-json" } })).analyze(request)).rejects.toThrow("LLM_INVALID_JSON_RESPONSE");
  });

  it("rejects non-loopback HTTP endpoints", async () => {
    await expect(createLlmClient({ provider: "openai-compatible", model: "synthetic", enabled: true, secretRef: "openai-key", endpoint: "http://remote.example/v1/chat/completions" }, secretStore, async () => response({})).analyze(request)).rejects.toThrow("LLM_ENDPOINT_INSECURE");
  });
});
