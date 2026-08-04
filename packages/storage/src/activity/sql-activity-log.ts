import type { ActivityLogPort, ActivityOperation } from "@pwm/application";
import type { ActivityOperationId, WorkspaceId } from "@pwm/contracts";
import type { SqlCipherConnection } from "../sqlcipher/driver";

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export async function initializeActivitySchema(connection: SqlCipherConnection): Promise<void> {
  await connection.exec("CREATE TABLE IF NOT EXISTS activity_operation (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, undoable INTEGER NOT NULL, undone_at TEXT, depends_on_json TEXT NOT NULL)");
  const columns = await connection.all<{ name: string }>("PRAGMA table_info(activity_operation)");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("updated_at")) await connection.exec("ALTER TABLE activity_operation ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  if (!names.has("version")) await connection.exec("ALTER TABLE activity_operation ADD COLUMN version INTEGER NOT NULL DEFAULT 0");
  if (!names.has("deleted_at")) await connection.exec("ALTER TABLE activity_operation ADD COLUMN deleted_at TEXT");
}

export class SqlActivityLog implements ActivityLogPort {
  constructor(private readonly connection: SqlCipherConnection) {}
  async append(operation: ActivityOperation): Promise<void> {
    await this.connection.exec(`INSERT INTO activity_operation (id, workspace_id, kind, entity_type, entity_id, summary, created_at, updated_at, version, deleted_at, undoable, undone_at, depends_on_json) VALUES (${quote(operation.id)}, ${quote(operation.workspaceId)}, ${quote(operation.kind)}, ${quote(operation.entityType)}, ${quote(operation.entityId)}, ${quote(operation.summary)}, ${quote(operation.createdAt)}, ${quote(operation.updatedAt)}, ${operation.version}, NULL, ${operation.undoable ? 1 : 0}, ${operation.undoneAt === null ? "NULL" : quote(operation.undoneAt)}, ${quote(JSON.stringify(operation.dependsOn))})`);
  }
  async latest(workspaceId: WorkspaceId): Promise<ActivityOperation | null> {
    const row = await this.connection.get<Record<string, unknown>>("SELECT id, workspace_id, kind, entity_type, entity_id, summary, created_at, undoable, undone_at, depends_on_json FROM activity_operation WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1", [workspaceId]);
    if (!row) return null;
    return { id: row.id as ActivityOperationId, workspaceId: row.workspace_id as WorkspaceId, kind: row.kind as ActivityOperation["kind"], entityType: row.entity_type as string, entityId: row.entity_id as string, summary: row.summary as string, createdAt: row.created_at as string, updatedAt: String(row.updated_at ?? row.created_at), version: Number(row.version ?? 0), deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : String(row.deleted_at), undoable: row.undoable === 1, undoneAt: row.undone_at as string | null, dependsOn: JSON.parse(String(row.depends_on_json)) as ActivityOperationId[] };
  }
  async markUndone(operationId: ActivityOperationId, undoneAt: string): Promise<void> { await this.connection.exec(`UPDATE activity_operation SET undone_at = ${quote(undoneAt)} WHERE id = ${quote(operationId)}`); }
}
