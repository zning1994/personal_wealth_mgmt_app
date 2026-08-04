import { z } from "zod";
import { ImportBatchIdSchema, WorkspaceIdSchema } from "../ids";

export const ImportBatchStatusSchema = z.enum([
  "draft", "extracting", "needs_mapping", "needs_ocr", "normalizing", "needs_review",
  "validating", "ready", "committed", "cancelled", "reverted",
]);

export const ImportDraftSchema = z.object({
  batchId: ImportBatchIdSchema,
  workspaceId: WorkspaceIdSchema,
  status: ImportBatchStatusSchema,
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime({ offset: true }),
  candidateCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  cancelReason: z.string().min(1).optional(),
}).strict();

export type ImportBatchStatus = z.infer<typeof ImportBatchStatusSchema>;
export type ImportDraft = z.infer<typeof ImportDraftSchema>;
