import { ImportDraftViewSchema, type ImportBatchId, type ImportDraftSummary, type ImportDraftView, type WorkspaceId } from "@pwm/contracts";
import type { SqlCipherConnection } from "../sqlcipher/driver";

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export interface ImportDraftStore {
  create(draft: ImportDraftView, displayName: string): Promise<void>;
  get(batchId: ImportBatchId): Promise<ImportDraftView | null>;
  list(): Promise<readonly ImportDraftSummary[]>;
  save(draft: ImportDraftView, expectedRevision: number): Promise<void>;
}

type DraftRow = {
  draft_json: string | null;
  display_name: string;
  revision: number;
  updated_at: string;
};

export class SqlImportDraftStore implements ImportDraftStore {
  constructor(private readonly connection: SqlCipherConnection, private readonly workspaceId: WorkspaceId) {}

  async create(draft: ImportDraftView, displayName: string): Promise<void> {
    const parsed = ImportDraftViewSchema.parse(draft);
    const updatedAt = new Date().toISOString();
    await this.connection.exec(`INSERT INTO import_batch (id, workspace_id, state, display_name, revision, updated_at, draft_json) VALUES (${quote(parsed.batchId)}, ${quote(this.workspaceId)}, ${quote(parsed.status)}, ${quote(displayName)}, ${parsed.revision}, ${quote(updatedAt)}, ${quote(JSON.stringify(parsed))})`);
  }

  async get(batchId: ImportBatchId): Promise<ImportDraftView | null> {
    const row = await this.connection.get<DraftRow>("SELECT draft_json, display_name, revision, updated_at FROM import_batch WHERE id = ? AND workspace_id = ?", [batchId, this.workspaceId]);
    if (!row?.draft_json) return null;
    return ImportDraftViewSchema.parse(JSON.parse(row.draft_json));
  }

  async list(): Promise<readonly ImportDraftSummary[]> {
    const rows = await this.connection.all<DraftRow & { id: string; state: string }>("SELECT id, state, display_name, revision, updated_at FROM import_batch WHERE workspace_id = ? ORDER BY updated_at DESC", [this.workspaceId]);
    return rows.map((row) => ({ batchId: row.id as ImportBatchId, status: row.state as ImportDraftSummary["status"], revision: row.revision, displayName: row.display_name, updatedAt: row.updated_at }));
  }

  async save(draft: ImportDraftView, expectedRevision: number): Promise<void> {
    const parsed = ImportDraftViewSchema.parse(draft);
    await this.connection.transaction(async () => {
      const current = await this.connection.get<{ revision: number }>("SELECT revision FROM import_batch WHERE id = ? AND workspace_id = ?", [parsed.batchId, this.workspaceId]);
      if (!current) throw new Error("IMPORT_BATCH_NOT_FOUND");
      if (current.revision !== expectedRevision) throw new Error("IMPORT_DRAFT_REVISION_CONFLICT");
      const updatedAt = new Date().toISOString();
      await this.connection.exec(`UPDATE import_batch SET state = ${quote(parsed.status)}, revision = ${parsed.revision}, updated_at = ${quote(updatedAt)}, draft_json = ${quote(JSON.stringify(parsed))} WHERE id = ${quote(parsed.batchId)} AND workspace_id = ${quote(this.workspaceId)} AND revision = ${expectedRevision}`);
    });
  }
}
