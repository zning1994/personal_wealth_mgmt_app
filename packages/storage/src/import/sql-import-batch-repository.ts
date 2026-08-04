import { ImportDraftSchema, type ImportDraft } from "@pwm/contracts";
import type { ImportBatchRepository } from "@pwm/application";

export interface EncryptedDraftDatabase { getImportDraft(batchId: string): Promise<unknown | null>; compareAndSwapImportDraft(batchId: string, expectedRevision: number, draft: ImportDraft): Promise<boolean> }

export class SqlImportBatchRepository implements ImportBatchRepository {
  constructor(private readonly database: EncryptedDraftDatabase) {}
  async load(batchId: string): Promise<ImportDraft | null> { const value = await this.database.getImportDraft(batchId); return value === null ? null : ImportDraftSchema.parse(value); }
  async save(draft: ImportDraft, expectedRevision: number): Promise<void> { if (!await this.database.compareAndSwapImportDraft(draft.batchId, expectedRevision, ImportDraftSchema.parse(draft))) throw new Error("IMPORT_DRAFT_REVISION_CONFLICT"); }
}
