import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { initializeImportSchema } from "../import/sql-import-repository";
import { initializeActivitySchema } from "../activity/sql-activity-log";
import { initializeLedgerSchema } from "./ledger-schema";
import { openSqlCipher, type SqlCipherConnection } from "../sqlcipher/driver";

export type WorkspaceMode = "read-write" | "recovery-read-only";
export type WorkspaceDatabase = { connection: SqlCipherConnection; filePath: string; mode: WorkspaceMode; close(): Promise<void>; createMigrationCheckpoint(): Promise<string> };
const schema = `CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL); INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 1); CREATE TABLE IF NOT EXISTS journal_entry (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, occurred_on TEXT NOT NULL, description TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, transfer_link_id TEXT); CREATE TABLE IF NOT EXISTS posting (id TEXT PRIMARY KEY, journal_id TEXT NOT NULL REFERENCES journal_entry(id), account_id TEXT NOT NULL, amount_minor TEXT NOT NULL, currency TEXT NOT NULL, role TEXT NOT NULL);`;
export async function openWorkspaceDatabase(input: { filePath: string; key: Uint8Array; mode?: WorkspaceMode }): Promise<WorkspaceDatabase> {
  await mkdir(dirname(input.filePath), { recursive: true }); const mode = input.mode ?? "read-write"; const connection = await openSqlCipher({ filePath: input.filePath, key: input.key, mode: mode === "recovery-read-only" ? "read-only" : "read-write" });
  if (mode === "read-write") { await connection.exec(schema); await initializeLedgerSchema(connection); await initializeImportSchema(connection); await initializeActivitySchema(connection); }
  return { connection, filePath: input.filePath, mode, close: () => connection.close(), createMigrationCheckpoint: async () => { const checkpoint = join(dirname(input.filePath), `checkpoint-${Date.now()}.db`); await copyFile(input.filePath, checkpoint); return checkpoint; } };
}
export async function assertWorkspaceExists(filePath: string): Promise<void> { const info = await stat(filePath); if (!info.isFile()) throw new Error("WORKSPACE_DATABASE_MISSING"); }
