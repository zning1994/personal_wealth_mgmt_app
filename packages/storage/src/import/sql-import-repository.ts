import type { ImportBatchWriteRepository, ImportCommitResult } from "@pwm/application";
import type { ImportBatchId, JournalEntryId, RawRecordId, WorkspaceId } from "@pwm/contracts";
import type { SqlCipherConnection } from "../sqlcipher/driver";

export async function initializeImportSchema(connection: SqlCipherConnection): Promise<void> {
  // Create tables before indexes so a legacy database can be migrated one column at a time.
  // `CREATE INDEX ... source_sha256` cannot run until the old import_commit table has
  // received the new nullable column below.
  await connection.exec(`CREATE TABLE IF NOT EXISTS import_batch (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, state TEXT NOT NULL, result_json TEXT, idempotency_key TEXT, source_sha256 TEXT, display_name TEXT NOT NULL DEFAULT 'Imported statement', revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT '', draft_json TEXT); CREATE TABLE IF NOT EXISTS import_commit (workspace_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, source_sha256 TEXT, result_json TEXT NOT NULL, PRIMARY KEY (workspace_id, idempotency_key)); CREATE TABLE IF NOT EXISTS journal_raw_record (journal_id TEXT NOT NULL, raw_record_id TEXT NOT NULL, PRIMARY KEY (journal_id, raw_record_id));`);
  const columns = await connection.all<{ name: string }>("PRAGMA table_info(import_batch)");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("display_name")) await connection.exec("ALTER TABLE import_batch ADD COLUMN display_name TEXT NOT NULL DEFAULT 'Imported statement'");
  if (!names.has("revision")) await connection.exec("ALTER TABLE import_batch ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
  if (!names.has("updated_at")) await connection.exec("ALTER TABLE import_batch ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  if (!names.has("draft_json")) await connection.exec("ALTER TABLE import_batch ADD COLUMN draft_json TEXT");
  if (!names.has("source_sha256")) await connection.exec("ALTER TABLE import_batch ADD COLUMN source_sha256 TEXT");
  const commitColumns = await connection.all<{ name: string }>("PRAGMA table_info(import_commit)");
  if (!new Set(commitColumns.map((column) => column.name)).has("source_sha256")) await connection.exec("ALTER TABLE import_commit ADD COLUMN source_sha256 TEXT");
  await connection.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_import_commit_source ON import_commit(workspace_id, source_sha256) WHERE source_sha256 IS NOT NULL");
}
export function createSqlImportRepository(connection: SqlCipherConnection): ImportBatchWriteRepository {
  const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
  return {
    findCommit: async (workspaceId: WorkspaceId, key: string) => { const row = await connection.get<{ result_json: string }>("SELECT result_json FROM import_commit WHERE workspace_id = ? AND idempotency_key = ?", [workspaceId, key]); return row ? JSON.parse(row.result_json) as ImportCommitResult : null; },
    findSourceCommit: async (workspaceId: WorkspaceId, sourceSha256: string) => { const row = await connection.get<{ result_json: string }>("SELECT result_json FROM import_commit WHERE workspace_id = ? AND source_sha256 = ? LIMIT 1", [workspaceId, sourceSha256]); return row ? JSON.parse(row.result_json) as ImportCommitResult : null; },
    linkRawRecord: async (journalId: JournalEntryId, rawRecordId: RawRecordId) => { await connection.exec(`INSERT INTO journal_raw_record (journal_id, raw_record_id) VALUES (${quote(journalId)}, ${quote(rawRecordId)})`); },
    markCommitted: async (batchId: ImportBatchId, result: ImportCommitResult, key: string, sourceSha256?: string) => { const batch = await connection.get<{ workspace_id: string }>("SELECT workspace_id FROM import_batch WHERE id = ?", [batchId]); if (!batch) throw new Error("IMPORT_BATCH_NOT_FOUND"); const serialized = JSON.stringify(result); await connection.exec(`INSERT INTO import_commit (workspace_id, idempotency_key, source_sha256, result_json) VALUES (${quote(batch.workspace_id)}, ${quote(key)}, ${sourceSha256 === undefined ? "NULL" : quote(sourceSha256)}, ${quote(serialized)})`); await connection.exec(`UPDATE import_batch SET state = 'committed', result_json = ${quote(serialized)}, idempotency_key = ${quote(key)}, source_sha256 = ${sourceSha256 === undefined ? "NULL" : quote(sourceSha256)} WHERE id = ${quote(batchId)} AND state NOT IN ('committed', 'cancelled', 'reverted')`); },
  };
}
