import { z } from "zod";
import { LlmProviderDtoSchema } from "./llm-settings";
import { ImportCandidateV1Schema } from "./import/candidate";

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

export const LlmImportPreviewInputSchema = z.object({ provider: LlmProviderDtoSchema, candidates: z.array(ImportCandidateV1Schema).min(1).max(100) }).strict();
export const LlmImportAnalyzeInputSchema = z.object({ provider: LlmProviderDtoSchema, candidates: z.array(ImportCandidateV1Schema).min(1).max(100), preview: TransmissionPreviewSchema, approval: TransmissionApprovalSchema }).strict();
export const LlmImportSuggestionSchema = z.object({ rawRecordId: z.string().uuid(), categoryAccountId: z.string().uuid().nullable(), confidence: z.number().min(0).max(1), explanation: z.string().max(500) }).strict();
export const LlmImportAnalysisResultSchema = z.object({ suggestions: z.array(LlmImportSuggestionSchema) }).strict();
export type LlmImportPreviewInput = z.infer<typeof LlmImportPreviewInputSchema>;
export type LlmImportAnalyzeInput = z.infer<typeof LlmImportAnalyzeInputSchema>;
export type LlmImportAnalysisResult = z.infer<typeof LlmImportAnalysisResultSchema>;
