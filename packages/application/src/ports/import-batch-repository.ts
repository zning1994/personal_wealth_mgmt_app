import type { ImportBatchId, ImportDraft } from "@pwm/contracts";

export interface ImportBatchRepository {
  load(batchId: ImportBatchId): Promise<ImportDraft | null>;
  save(draft: ImportDraft, expectedRevision: number): Promise<void>;
}
