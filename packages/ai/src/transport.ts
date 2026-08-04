import { LlmAnalysisRequestSchema, LlmProviderConfigSchema, type LlmAnalysisRequest, type LlmClient, type LlmFetch, type LlmProviderConfig, type LlmSecretStore } from "./contracts";

export const DEFAULT_LLM_ENDPOINTS: Record<LlmProviderConfig["provider"], string> = {
  openai: "https://api.openai.com/v1/responses",
  anthropic: "https://api.anthropic.com/v1/messages",
  "openai-compatible": "http://127.0.0.1:8000/v1/chat/completions",
  "deepseek-responses": "https://api.deepseek.com/v1/responses",
  ollama: "http://127.0.0.1:11434/api/chat",
};

export function resolveLlmEndpoint(config: Pick<LlmProviderConfig, "provider" | "endpoint">): string {
  return config.endpoint ?? DEFAULT_LLM_ENDPOINTS[config.provider];
}

function boundedString(value: unknown, max = 100_000): string {
  if (typeof value !== "string") throw new Error("LLM_INVALID_TEXT_RESPONSE");
  return value.length > max ? value.slice(0, max) : value;
}

function promptFor(request: LlmAnalysisRequest): string {
  const parts = request.parts.map((part) => `[${part.field}]\n${part.text}`).join("\n\n");
  const schema = request.responseSchema ? `\nReturn JSON matching this schema:\n${JSON.stringify(request.responseSchema)}` : "\nReturn only valid JSON.";
  return `${request.instruction}${schema}\n\nSource fields (already extracted locally; do not infer missing data):\n${parts}`;
}

function responseText(provider: LlmProviderConfig["provider"], body: unknown): string {
  if (!body || typeof body !== "object") throw new Error("LLM_INVALID_RESPONSE");
  const value = body as Record<string, unknown>;
  if (provider === "deepseek-responses" || provider === "openai") {
    if (typeof value.output_text === "string") return boundedString(value.output_text);
    const output = Array.isArray(value.output) ? value.output : [];
    const text = output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : []).map((item) => item && typeof item === "object" ? (item as Record<string, unknown>).text : null).find((item): item is string => typeof item === "string");
    if (text) return boundedString(text);
  }
  if (provider === "anthropic") {
    const content = Array.isArray(value.content) ? value.content : [];
    const text = content.map((item) => item && typeof item === "object" ? (item as Record<string, unknown>).text : null).find((item): item is string => typeof item === "string");
    if (text) return boundedString(text);
  }
  if (provider === "ollama") {
    const message = value.message;
    if (message && typeof message === "object" && typeof (message as Record<string, unknown>).content === "string") return boundedString((message as Record<string, unknown>).content);
  }
  const choices = Array.isArray(value.choices) ? value.choices : [];
  const first = choices[0];
  if (first && typeof first === "object") {
    const message = (first as Record<string, unknown>).message;
    if (message && typeof message === "object" && typeof (message as Record<string, unknown>).content === "string") return boundedString((message as Record<string, unknown>).content);
    if (typeof (first as Record<string, unknown>).text === "string") return boundedString((first as Record<string, unknown>).text);
  }
  throw new Error("LLM_INVALID_TEXT_RESPONSE");
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try { return JSON.parse(trimmed) as unknown; } catch { throw new Error("LLM_INVALID_JSON_RESPONSE"); }
}

function assertSafeEndpoint(endpoint: string): void {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("LLM_ENDPOINT_INVALID"); }
  if (url.protocol === "https:") return;
  const loopback = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname.startsWith("127."));
  if (!loopback) throw new Error("LLM_ENDPOINT_INSECURE");
}

export function createLlmClient(configInput: LlmProviderConfig, secrets: LlmSecretStore, fetcher: LlmFetch = async (input, init) => { const response = await fetch(input, init); let body: unknown; try { body = await response.json(); } catch { body = null; } return { status: response.status, headers: response.headers, body }; }): LlmClient {
  const config = LlmProviderConfigSchema.parse(configInput);
  return { analyze: async (requestInput, signal) => {
    const request = LlmAnalysisRequestSchema.parse(requestInput);
    if (!config.enabled) throw new Error("LLM_PROVIDER_DISABLED");
    const secret = config.provider === "ollama" ? null : await secrets.get(config.secretRef!);
    if (config.provider !== "ollama" && (!secret || secret.length < 8)) throw new Error("LLM_SECRET_UNAVAILABLE");
    const prompt = promptFor(request);
    const endpoint = resolveLlmEndpoint(config);
    assertSafeEndpoint(endpoint);
    let body: Record<string, unknown>;
    let headers: Record<string, string> = { "content-type": "application/json" };
    if (config.provider === "anthropic") { headers = { ...headers, "x-api-key": secret!, "anthropic-version": "2023-06-01" }; body = { model: config.model, max_tokens: request.maxOutputTokens, system: "You analyze user-provided financial text. Never invent missing values.", messages: [{ role: "user", content: prompt }] }; }
    else if (config.provider === "deepseek-responses") { headers = { ...headers, authorization: `Bearer ${secret!}` }; body = { model: config.model, input: prompt, max_output_tokens: request.maxOutputTokens, store: false, response_format: { type: "json_object" } }; }
    else if (config.provider === "ollama") body = { model: config.model, stream: false, format: "json", messages: [{ role: "user", content: prompt }] };
    else if (config.provider === "openai" && endpoint.endsWith("/responses")) { headers = { ...headers, authorization: `Bearer ${secret!}` }; body = { model: config.model, input: [{ role: "system", content: [{ type: "input_text", text: "You analyze user-provided financial text. Never invent missing values. Return only JSON." }] }, { role: "user", content: [{ type: "input_text", text: prompt }] }], max_output_tokens: request.maxOutputTokens, store: false, text: { format: { type: "json_object" } } }; }
    else { headers = { ...headers, authorization: `Bearer ${secret!}` }; body = { model: config.model, temperature: 0, max_tokens: request.maxOutputTokens, messages: [{ role: "system", content: "You analyze user-provided financial text. Never invent missing values. Return only JSON." }, { role: "user", content: prompt }], response_format: { type: "json_object" } }; }
    const init: RequestInit = { method: "POST", headers, body: JSON.stringify(body) };
    if (signal) init.signal = signal;
    const response = await fetcher(endpoint, init);
    if (response.status < 200 || response.status >= 300) throw new Error(`LLM_HTTP_${response.status}`);
    return parseJson(responseText(config.provider, response.body));
  } };
}
