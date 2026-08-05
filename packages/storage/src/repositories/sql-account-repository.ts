import type { CreateAccountInput, AccountDto } from "@pwm/contracts";
import { AccountDtoSchema } from "@pwm/contracts";
import type { AccountId } from "@pwm/contracts";
import type { SqlCipherConnection } from "../sqlcipher/driver";

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export interface AccountRepository { list(workspaceId: string): Promise<readonly AccountDto[]>; create(input: CreateAccountInput): Promise<AccountDto> }

export function createSqlAccountRepository(connection: SqlCipherConnection, ids: { account: () => AccountId }): AccountRepository {
  return {
    async list(workspaceId) {
      const rows = await connection.all<Record<string, unknown>>("SELECT id, workspace_id, name, kind, currency, version, deleted_at, created_at, updated_at FROM account WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY name, id", [workspaceId]);
      return rows.map((row) => AccountDtoSchema.parse({ id: row.id, workspaceId: row.workspace_id, name: row.name, kind: row.kind, currency: row.currency, version: row.version, deletedAt: row.deleted_at, createdAt: row.created_at, updatedAt: row.updated_at }));
    },
    async create(input) {
      const id = ids.account();
      const now = new Date().toISOString();
      const row = AccountDtoSchema.parse({ id, workspaceId: input.workspaceId, name: input.name.trim(), kind: input.kind, currency: input.currency, version: 0, deletedAt: null, createdAt: now, updatedAt: now });
      await connection.exec(`INSERT INTO account (id, workspace_id, name, kind, currency, version, deleted_at, created_at, updated_at) VALUES (${quote(row.id)}, ${quote(row.workspaceId)}, ${quote(row.name)}, ${quote(row.kind)}, ${quote(row.currency)}, 0, NULL, ${quote(row.createdAt)}, ${quote(row.updatedAt)})`);
      return row;
    },
  };
}
