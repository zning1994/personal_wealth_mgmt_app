import { z } from "zod";
import { LlmProviderDtoSchema } from "./llm-settings";
import { ImportCandidateV1Schema } from "./import/candidate";
import { ImportBatchIdSchema } from "./ids";

export const TransmissionDataTypeSchema = z.enum(["text", "image", "file"]);
export const TransmissionDraftSchema = z.object({
  providerId: z.string().min(1).max(200),
  providerName: z.string().min(1).max(200),
  baseUrl: z.string().url(),
  model: z.string().min(1).max(200),
  dataTypes: z.array(TransmissionDataTypeSchema).min(1).max(3),
  text: z.string().max(200_000).optional(),
  imageSha256: z.array(z.string().regex(/^[a-f0-9]{64}$/u)).max(100).default([]),
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
}).strict();
export type TransmissionDraft = z.infer<typeof TransmissionDraftSchema>;

export const TransmissionPreviewSchema = z.object({
  draft: TransmissionDraftSchema,
  redactedText: z.string(),
  textCharacters: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  risks: z.array(z.enum(["REMOTE_PROVIDER_RECEIVES_FINANCIAL_TEXT", "REMOTE_PROVIDER_RECEIVES_PAGE_IMAGE", "REMOTE_PROVIDER_RECEIVES_ORIGINAL_FILE"])),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type TransmissionPreview = z.infer<typeof TransmissionPreviewSchema>;

export const TransmissionApprovalSchema = z.object({
  approvalId: z.string().uuid(),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  approvedAt: z.string().datetime({ offset: true }),
}).strict();
export type TransmissionApproval = z.infer<typeof TransmissionApprovalSchema>;

export const LlmFallbackModeSchema = z.enum(["original_pdf", "page_images"]);
export const LlmFallbackSourceSchema = z.object({
  token: z.string().min(32).max(256),
  batchId: ImportBatchIdSchema,
  mode: LlmFallbackModeSchema,
  pages: z.array(z.number().int().positive()).min(1).max(100),
  pageCount: z.number().int().positive().max(100),
  byteLength: z.number().int().positive().max(25 * 1024 * 1024),
  imageCount: z.number().int().nonnegative().max(100),
  fileCount: z.number().int().nonnegative().max(1),
  mimeType: z.string().min(1).max(200),
  displayName: z.string().min(1).max(255),
}).strict();
export type LlmFallbackMode = z.infer<typeof LlmFallbackModeSchema>;
export type LlmFallbackSource = z.infer<typeof LlmFallbackSourceSchema>;

export const LlmImportPreviewInputSchema = z.object({ provider: LlmProviderDtoSchema, candidates: z.array(ImportCandidateV1Schema).min(1).max(100), batchId: ImportBatchIdSchema.optional(), fallbackToken: z.string().min(32).max(256).optional() }).strict();
export const LlmImportAnalyzeInputSchema = z.object({ provider: LlmProviderDtoSchema, candidates: z.array(ImportCandidateV1Schema).min(1).max(100), batchId: ImportBatchIdSchema.optional(), fallbackToken: z.string().min(32).max(256).optional(), preview: TransmissionPreviewSchema, approval: TransmissionApprovalSchema }).strict();
export const LlmImportSuggestionSchema = z.object({ rawRecordId: z.string().uuid(), categoryAccountId: z.string().uuid().nullable(), confidence: z.number().min(0).max(1), explanation: z.string().max(500) }).strict();
export const LlmImportAnalysisResultSchema = z.object({ suggestions: z.array(LlmImportSuggestionSchema) }).strict();
export type LlmImportPreviewInput = z.infer<typeof LlmImportPreviewInputSchema>;
export type LlmImportAnalyzeInput = z.infer<typeof LlmImportAnalyzeInputSchema>;
export type LlmImportAnalysisResult = z.infer<typeof LlmImportAnalysisResultSchema>;
