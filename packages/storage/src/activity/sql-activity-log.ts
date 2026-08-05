import { activityInverseTargetIds, DEFAULT_INVERSE_RETENTION, type ActivityInverse, type ActivityLogPort, type ActivityOperation, type ActivityRecord } from "@pwm/application";
import type { ActivityOperationId, WorkspaceId } from "@pwm/contracts";
import type { SqlCipherConnection } from "../sqlcipher/driver";

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export async function initializeActivitySchema(connection: SqlCipherConnection): Promise<void> {
  await connection.exec("CREATE TABLE IF NOT EXISTS activity_operation (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, undoable INTEGER NOT NULL, undone_at TEXT, depends_on_json TEXT NOT NULL, inverse_json TEXT)");
  const columns = await connection.all<{ name: string }>("PRAGMA table_info(activity_operation)");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("updated_at")) await connection.exec("ALTER TABLE activity_operation ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  if (!names.has("version")) await connection.exec("ALTER TABLE activity_operation ADD COLUMN version INTEGER NOT NULL DEFAULT 0");
  if (!names.has("deleted_at")) await connection.exec("ALTER TABLE activity_operation ADD COLUMN deleted_at TEXT");
  if (!names.has("inverse_json")) await connection.exec("ALTER TABLE activity_operation ADD COLUMN inverse_json TEXT");
}

export class SqlActivityLog implements ActivityLogPort {
  constructor(private readonly connection: SqlCipherConnection) {}
  async append(operation: ActivityOperation, inverse: ActivityInverse | null = null): Promise<void> {
    await this.connection.exec(`INSERT INTO activity_operation (id, workspace_id, kind, entity_type, entity_id, summary, created_at, updated_at, version, deleted_at, undoable, undone_at, depends_on_json, inverse_json) VALUES (${quote(operation.id)}, ${quote(operation.workspaceId)}, ${quote(operation.kind)}, ${quote(operation.entityType)}, ${quote(operation.entityId)}, ${quote(operation.summary)}, ${quote(operation.createdAt)}, ${quote(operation.updatedAt)}, ${operation.version}, NULL, ${operation.undoable ? 1 : 0}, ${operation.undoneAt === null ? "NULL" : quote(operation.undoneAt)}, ${quote(JSON.stringify(operation.dependsOn))}, ${inverse === null ? "NULL" : quote(JSON.stringify(inverse))})`);
    if (inverse !== null) {
      const rows = await this.connection.all<{ id: string }>("SELECT id FROM activity_operation WHERE workspace_id = ? AND inverse_json IS NOT NULL ORDER BY created_at DESC, rowid DESC", [operation.workspaceId]);
      for (const row of rows.slice(DEFAULT_INVERSE_RETENTION.maxOperations)) await this.connection.exec(`UPDATE activity_operation SET inverse_json = NULL, undoable = 0 WHERE id = ${quote(row.id)}`);
    }
  }
  private operationFromRow(row: Record<string, unknown>): ActivityOperation {
    return { id: row.id as ActivityOperationId, workspaceId: row.workspace_id as WorkspaceId, kind: row.kind as ActivityOperation["kind"], entityType: row.entity_type as string, entityId: row.entity_id as string, summary: row.summary as string, createdAt: row.created_at as string, updatedAt: String(row.updated_at ?? row.created_at), version: Number(row.version ?? 0), deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : String(row.deleted_at), undoable: row.undoable === 1, undoneAt: row.undone_at === null || row.undone_at === undefined ? null : String(row.undone_at), dependsOn: JSON.parse(String(row.depends_on_json)) as ActivityOperationId[] };
  }
  private recordFromRow(row: Record<string, unknown>): ActivityRecord {
    return { operation: this.operationFromRow(row), inverse: row.inverse_json === null || row.inverse_json === undefined ? null : JSON.parse(String(row.inverse_json)) as ActivityInverse };
  }
  private async rows(workspaceId: WorkspaceId): Promise<readonly Record<string, unknown>[]> {
    return this.connection.all<Record<string, unknown>>("SELECT id, workspace_id, kind, entity_type, entity_id, summary, created_at, updated_at, version, deleted_at, undoable, undone_at, depends_on_json, inverse_json FROM activity_operation WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC", [workspaceId]);
  }
  async latest(workspaceId: WorkspaceId): Promise<ActivityOperation | null> {
    const row = (await this.rows(workspaceId))[0];
    if (!row) return null;
    return this.operationFromRow(row);
  }
  async list(workspaceId: WorkspaceId, limit = 30): Promise<readonly ActivityOperation[]> { return (await this.rows(workspaceId)).slice(0, Math.max(1, Math.min(100, limit))).map((row) => this.operationFromRow(row)); }
  private async findRecord(workspaceId: WorkspaceId, operationId: ActivityOperationId): Promise<ActivityRecord | null> {
    const row = await this.connection.get<Record<string, unknown>>("SELECT id, workspace_id, kind, entity_type, entity_id, summary, created_at, updated_at, version, deleted_at, undoable, undone_at, depends_on_json, inverse_json FROM activity_operation WHERE workspace_id = ? AND id = ?", [workspaceId, operationId]);
    return row ? this.recordFromRow(row) : null;
  }
  async findForUndo(workspaceId: WorkspaceId, operationId: ActivityOperationId): Promise<ActivityRecord | null> {
    const candidate = await this.findRecord(workspaceId, operationId);
    if (!candidate?.inverse) return candidate;
    const targetIds = new Set(activityInverseTargetIds(candidate.inverse));
    const later = (await this.rows(workspaceId)).map((row) => this.recordFromRow(row)).filter((record) => record.operation.createdAt > candidate.operation.createdAt && record.operation.undoneAt === null);
    if (later.some((record) => targetIds.has(record.operation.entityId) || activityInverseTargetIds(record.inverse).some((id) => targetIds.has(id)))) return null;
    return candidate;
  }
  async latestForUndo(workspaceId: WorkspaceId): Promise<ActivityRecord | null> {
    const records = (await this.rows(workspaceId)).map((row) => this.recordFromRow(row));
    const cutoff = Date.now() - DEFAULT_INVERSE_RETENTION.days * 86_400_000;
    let retained = 0;
    for (const candidate of records) {
      const operation = candidate.operation;
      if (!operation.undoable || operation.undoneAt || !candidate.inverse) continue;
      if (Number.isNaN(Date.parse(operation.createdAt)) || Date.parse(operation.createdAt) < cutoff || retained >= DEFAULT_INVERSE_RETENTION.maxOperations) continue;
      retained += 1;
      const targetIds = new Set(activityInverseTargetIds(candidate.inverse));
      const hasDependent = records.some((later) => later.operation.createdAt > operation.createdAt && later.operation.undoneAt === null && (targetIds.has(later.operation.entityId) || activityInverseTargetIds(later.inverse).some((id) => targetIds.has(id))));
      if (!hasDependent) return candidate;
    }
    return null;
  }
  async markUndone(operationId: ActivityOperationId, undoneAt: string): Promise<void> { await this.connection.exec(`UPDATE activity_operation SET undone_at = ${quote(undoneAt)}, updated_at = ${quote(undoneAt)} WHERE id = ${quote(operationId)}`); }
}
