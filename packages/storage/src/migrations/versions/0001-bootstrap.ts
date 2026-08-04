import type { Migration } from "../migration-runner";

export const bootstrapMigration: Migration = {
  version: 1,
  name: "bootstrap",
  async up(connection) { await connection.exec("CREATE TABLE IF NOT EXISTS workspace_meta (id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS storage_health (checked_at TEXT NOT NULL, result TEXT NOT NULL)"); },
  async verify(connection) { const rows = await connection.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('workspace_meta', 'storage_health')"); if (rows.length !== 2) throw new Error("bootstrap-verification-failed"); },
};
