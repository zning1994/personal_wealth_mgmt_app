import type { ImportCommitTransaction, ImportCommitUnitOfWork, ImportLedgerWriter } from "@pwm/application";
import type { JournalEntry } from "@pwm/domain";
import type { SqlCipherConnection } from "../sqlcipher/driver";
import { createSqlImportRepository } from "../import/sql-import-repository";

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
class SqlLedgerWriter implements ImportLedgerWriter {
  constructor(private readonly connection: SqlCipherConnection) {}
  async saveJournal(journal: JournalEntry): Promise<void> { await this.connection.exec(`INSERT INTO journal_entry (id, workspace_id, occurred_on, description, version, deleted_at, transfer_link_id) VALUES (${quote(journal.id)}, ${quote(journal.workspaceId)}, ${quote(journal.occurredOn)}, ${quote(journal.description)}, ${journal.version}, NULL, NULL)`); for (const posting of journal.postings) await this.connection.exec(`INSERT INTO posting (id, journal_id, account_id, amount_minor, currency, role) VALUES (${quote(posting.id)}, ${quote(journal.id)}, ${quote(posting.accountId)}, ${quote(posting.amount.minor.toString())}, ${quote(posting.amount.currency)}, ${quote(posting.role)})`); }
}
export class SqlImportUnitOfWork implements ImportCommitUnitOfWork {
  constructor(private readonly connection: SqlCipherConnection) {}
  run<T>(work: (transaction: ImportCommitTransaction) => Promise<T>): Promise<T> { return this.connection.transaction(() => work({ ledger: new SqlLedgerWriter(this.connection), imports: createSqlImportRepository(this.connection) })); }
}
