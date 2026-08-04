import type { LedgerRepository } from "@pwm/application";
import type { AccountId, JournalEntryId, PostingId, WorkspaceId } from "@pwm/contracts";
import type { JournalEntry } from "@pwm/domain";
import type { SqlCipherConnection } from "../sqlcipher/driver";

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

type JournalRow = { id: string; workspace_id: string; occurred_on: string; description: string; version: number; deleted_at: string | null; transfer_link_id: string | null };
type PostingRow = { id: string; account_id: string; amount_minor: string; currency: string; role: JournalEntry["postings"][number]["role"] };

async function loadJournal(connection: SqlCipherConnection, row: JournalRow): Promise<JournalEntry> {
  const postings = await connection.all<PostingRow>("SELECT id, account_id, amount_minor, currency, role FROM posting WHERE journal_id = ? ORDER BY rowid", [row.id]);
  return { id: row.id as JournalEntryId, workspaceId: row.workspace_id as WorkspaceId, occurredOn: row.occurred_on, description: row.description, version: row.version, deletedAt: row.deleted_at, transferLinkId: row.transfer_link_id, postings: postings.map((posting) => ({ id: posting.id as PostingId, accountId: posting.account_id as AccountId, amount: { currency: posting.currency as never, minor: BigInt(posting.amount_minor) }, role: posting.role })) };
}

export function createSqlLedgerRepository(connection: SqlCipherConnection): LedgerRepository {
  return {
    async findJournalById(id) {
      const row = await connection.get<JournalRow>("SELECT id, workspace_id, occurred_on, description, version, deleted_at, transfer_link_id FROM journal_entry WHERE id = ?", [id]);
      return row ? loadJournal(connection, row) : null;
    },
    async listJournals(workspaceId, input = {}) {
      const clauses = ["workspace_id = ?"];
      const params: unknown[] = [workspaceId];
      if (!input.includeDeleted) clauses.push("deleted_at IS NULL");
      if (input.from !== undefined) { clauses.push("occurred_on >= ?"); params.push(input.from); }
      if (input.to !== undefined) { clauses.push("occurred_on <= ?"); params.push(input.to); }
      const rows = await connection.all<JournalRow>(`SELECT id, workspace_id, occurred_on, description, version, deleted_at, transfer_link_id FROM journal_entry WHERE ${clauses.join(" AND ")} ORDER BY occurred_on DESC, rowid DESC`, params);
      return Promise.all(rows.map((row) => loadJournal(connection, row)));
    },
    async findJournalByIdempotencyKey(workspaceId, key) {
      const row = await connection.get<{ journal_id: string }>("SELECT journal_id FROM journal_idempotency WHERE workspace_id = ? AND idempotency_key = ?", [workspaceId, key]);
      return row ? this.findJournalById(row.journal_id as JournalEntryId) : null;
    },
    async saveJournal(entry, idempotencyKey) {
      await connection.exec(`INSERT INTO journal_entry (id, workspace_id, occurred_on, description, version, deleted_at, transfer_link_id) VALUES (${quote(entry.id)}, ${quote(entry.workspaceId)}, ${quote(entry.occurredOn)}, ${quote(entry.description)}, ${entry.version}, NULL, NULL)`);
      for (const posting of entry.postings) await connection.exec(`INSERT INTO posting (id, journal_id, account_id, amount_minor, currency, role) VALUES (${quote(posting.id)}, ${quote(entry.id)}, ${quote(posting.accountId)}, ${quote(posting.amount.minor.toString())}, ${quote(posting.amount.currency)}, ${quote(posting.role)})`);
      await connection.exec(`INSERT INTO journal_idempotency (workspace_id, idempotency_key, journal_id) VALUES (${quote(entry.workspaceId)}, ${quote(idempotencyKey)}, ${quote(entry.id)})`);
    },
    async replaceJournal(entry, expectedVersion) {
      const current = await connection.get<{ version: number }>("SELECT version FROM journal_entry WHERE id = ?", [entry.id]);
      if (!current || current.version !== expectedVersion) throw new Error("VERSION_CONFLICT");
      await connection.exec(`UPDATE journal_entry SET occurred_on = ${quote(entry.occurredOn)}, description = ${quote(entry.description)}, version = ${entry.version}, deleted_at = ${entry.deletedAt === null ? "NULL" : quote(entry.deletedAt)}, transfer_link_id = ${entry.transferLinkId === null ? "NULL" : quote(entry.transferLinkId)} WHERE id = ${quote(entry.id)} AND version = ${expectedVersion}`);
      await connection.exec(`DELETE FROM posting WHERE journal_id = ${quote(entry.id)}`);
      for (const posting of entry.postings) await connection.exec(`INSERT INTO posting (id, journal_id, account_id, amount_minor, currency, role) VALUES (${quote(posting.id)}, ${quote(entry.id)}, ${quote(posting.accountId)}, ${quote(posting.amount.minor.toString())}, ${quote(posting.amount.currency)}, ${quote(posting.role)})`);
    },
  };
}

export function createSqlLedgerUnitOfWork(connection: SqlCipherConnection) {
  const repository = createSqlLedgerRepository(connection);
  return { run<T>(work: (context: { ledger: LedgerRepository }) => Promise<T>): Promise<T> { return connection.transaction(() => work({ ledger: repository })); } };
}
