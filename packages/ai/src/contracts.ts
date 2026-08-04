import { z } from "zod";

export const LlmProviderSchema = z.enum(["openai", "anthropic", "openai-compatible", "deepseek-responses", "ollama"]);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const LlmProviderConfigSchema = z.object({
  provider: LlmProviderSchema,
  model: z.string().min(1).max(200),
  endpoint: z.string().url().optional(),
  secretRef: z.string().min(1).max(200).optional(),
  enabled: z.boolean().default(true),
}).strict().superRefine((config, context) => {
  if (config.provider !== "ollama" && !config.secretRef) context.addIssue({ code: z.ZodIssueCode.custom, path: ["secretRef"], message: "BYOK provider requires a secret reference" });
});
export type LlmProviderConfig = z.infer<typeof LlmProviderConfigSchema>;

export const LlmTextPartSchema = z.object({
  field: z.string().min(1).max(80),
  text: z.string().min(1).max(50_000),
}).strict();
export type LlmTextPart = z.infer<typeof LlmTextPartSchema>;

export const LlmAnalysisRequestSchema = z.object({
  task: z.enum(["categorize-import", "explain-import", "extract-fields"]),
  instruction: z.string().min(1).max(4_000),
  parts: z.array(LlmTextPartSchema).min(1).max(100),
  responseSchema: z.record(z.unknown()).optional(),
  maxOutputTokens: z.number().int().min(1).max(16_384).default(2_000),
}).strict();
export type LlmAnalysisRequest = z.infer<typeof LlmAnalysisRequestSchema>;
export type LlmAnalysisRequestInput = z.input<typeof LlmAnalysisRequestSchema>;

export type LlmTransportResponse = { status: number; headers: Headers; body: unknown };
export type LlmFetch = (input: string | URL, init?: RequestInit) => Promise<LlmTransportResponse>;
export interface LlmSecretStore { get(secretRef: string): Promise<string | null> }
export interface LlmClient { analyze(request: LlmAnalysisRequestInput, signal?: AbortSignal): Promise<unknown> }
