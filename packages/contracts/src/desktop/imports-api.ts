import { z } from "zod";
import { ImportBatchIdSchema, RawRecordIdSchema, type WorkspaceId } from "../ids";
import { ImportCandidateV1Schema } from "../import/candidate";
import { ImportBatchStatusSchema } from "../import/state";
import { LlmFallbackModeSchema, LlmFallbackSourceSchema } from "../llm-consent";

export const SelectedSourceSchema = z.object({ token: z.string().min(32), displayName: z.string().min(1), mimeType: z.string().min(1), byteLength: z.number().int().nonnegative() }).strict();
export const CreateImportDraftInputSchema = z.object({ sourceToken: z.string().min(32) }).strict();
export const ImportDraftViewSchema = z.object({ batchId: ImportBatchIdSchema, sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u), sourceDocument: z.object({ displayName: z.string().min(1).max(255), mimeType: z.string().min(1).max(200), extension: z.string().regex(/^\.[a-z0-9]{1,12}$/u), pageCount: z.number().int().positive().max(100).optional(), objectKey: z.string().min(1).max(500).optional() }).strict().optional(), status: ImportBatchStatusSchema, revision: z.number().int().nonnegative(), candidates: z.array(ImportCandidateV1Schema), skippedRawRecordIds: z.array(RawRecordIdSchema), warnings: z.array(z.string()) }).strict();
export const ImportDraftSummarySchema = z.object({ batchId: ImportBatchIdSchema, status: ImportBatchStatusSchema, revision: z.number().int().nonnegative(), displayName: z.string().min(1), updatedAt: z.string().datetime({ offset: true }) }).strict();
export const UpdateCandidateInputSchema = z.object({ batchId: ImportBatchIdSchema, rawRecordId: RawRecordIdSchema, expectedRevision: z.number().int().nonnegative(), candidate: ImportCandidateV1Schema }).strict();
export const SkipCandidateInputSchema = z.object({ batchId: ImportBatchIdSchema, rawRecordId: RawRecordIdSchema, expectedRevision: z.number().int().nonnegative(), reasonCode: z.enum(["header", "footer", "duplicate", "unparseable", "user_excluded"]), explanation: z.string().min(1).max(500) }).strict();
export const CommitImportInputSchema = z.object({ workspaceId: z.string().uuid(), batchId: ImportBatchIdSchema, sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u), idempotencyKey: z.string().uuid(), entries: z.array(z.object({ rawRecordIds: z.array(RawRecordIdSchema), occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), description: z.string().min(1), postings: z.array(z.object({ accountId: z.string().uuid(), amountMinor: z.string().regex(/^-?\d+$/), currency: z.string().regex(/^[A-Z]{3}$/) }).strict()).min(2) }).strict()).min(1) }).strict();
export const CommittedBatchViewSchema = z.object({ batchId: ImportBatchIdSchema, journalIds: z.array(z.string().uuid()) }).strict();
export const PrepareLlmFallbackInputSchema = z.object({ batchId: ImportBatchIdSchema, mode: LlmFallbackModeSchema, pages: z.array(z.number().int().positive()).min(1).max(100).optional() }).strict();
export type SelectedSource = z.infer<typeof SelectedSourceSchema>;
export type CreateImportDraftInput = z.infer<typeof CreateImportDraftInputSchema>;
export type ImportDraftView = z.infer<typeof ImportDraftViewSchema>;
export type ImportDraftSummary = z.infer<typeof ImportDraftSummarySchema>;
export type UpdateCandidateInput = z.infer<typeof UpdateCandidateInputSchema>;
export type SkipCandidateInput = z.infer<typeof SkipCandidateInputSchema>;
export type CommitImportInput = z.infer<typeof CommitImportInputSchema>;
export type CommittedBatchView = z.infer<typeof CommittedBatchViewSchema>;
export type PrepareLlmFallbackInput = z.infer<typeof PrepareLlmFallbackInputSchema>;
export interface ImportsApi { getWorkspaceId(): Promise<WorkspaceId>; selectSource(): Promise<SelectedSource | null>; createDraft(input: CreateImportDraftInput): Promise<ImportDraftView>; getDraft(batchId: z.infer<typeof ImportBatchIdSchema>): Promise<ImportDraftView>; listDrafts(): Promise<readonly ImportDraftSummary[]>; updateCandidate(input: UpdateCandidateInput): Promise<ImportDraftView>; skipCandidate(input: SkipCandidateInput): Promise<ImportDraftView>; commit(input: CommitImportInput): Promise<CommittedBatchView>; cancel(batchId: z.infer<typeof ImportBatchIdSchema>): Promise<void>; prepareLlmFallback(input: PrepareLlmFallbackInput): Promise<z.infer<typeof LlmFallbackSourceSchema>> }
