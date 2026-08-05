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

const AttachmentBytesSchema: z.ZodType<Uint8Array<ArrayBufferLike>> = z.custom<Uint8Array<ArrayBufferLike>>((value) => value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= 25 * 1024 * 1024, "LLM_ATTACHMENT_LIMIT_EXCEEDED");
export const LlmImageAttachmentSchema = z.object({ mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]), bytes: AttachmentBytesSchema }).strict();
export const LlmFileAttachmentSchema = z.object({ filename: z.string().min(1).max(255), mimeType: z.literal("application/pdf"), bytes: AttachmentBytesSchema }).strict();
export const LlmAttachmentBundleSchema = z.object({ images: z.array(LlmImageAttachmentSchema).max(100).optional(), file: LlmFileAttachmentSchema.optional() }).strict().refine((value) => (value.images?.length ?? 0) > 0 || value.file !== undefined, "LLM_ATTACHMENT_EMPTY");
export type LlmImageAttachment = z.infer<typeof LlmImageAttachmentSchema>;
export type LlmFileAttachment = z.infer<typeof LlmFileAttachmentSchema>;
export type LlmAttachmentBundle = z.infer<typeof LlmAttachmentBundleSchema>;

export const LlmAnalysisRequestSchema = z.object({
  task: z.enum(["categorize-import", "explain-import", "extract-fields"]),
  instruction: z.string().min(1).max(4_000),
  parts: z.array(LlmTextPartSchema).min(1).max(100),
  attachments: LlmAttachmentBundleSchema.optional(),
  responseSchema: z.record(z.unknown()).optional(),
  maxOutputTokens: z.number().int().min(1).max(16_384).default(2_000),
}).strict();
export type LlmAnalysisRequest = z.infer<typeof LlmAnalysisRequestSchema>;
export type LlmAnalysisRequestInput = z.input<typeof LlmAnalysisRequestSchema>;

export type LlmTransportResponse = { status: number; headers: Headers; body: unknown };
export type LlmFetch = (input: string | URL, init?: RequestInit) => Promise<LlmTransportResponse>;
export interface LlmSecretStore { get(secretRef: string): Promise<string | null> }
export interface LlmClient { analyze(request: LlmAnalysisRequestInput, signal?: AbortSignal): Promise<unknown> }
