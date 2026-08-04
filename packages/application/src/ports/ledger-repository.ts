import type { JournalEntryId, WorkspaceId } from "@pwm/contracts";
import type { JournalEntry } from "@pwm/domain";
import type { UnitOfWork } from "./unit-of-work";

export interface LedgerRepository {
  findJournalById(id: JournalEntryId): Promise<JournalEntry | null>;
  listJournals?(workspaceId: WorkspaceId, input?: { from?: string; to?: string; includeDeleted?: boolean }): Promise<readonly JournalEntry[]>;
  findJournalByIdempotencyKey(workspaceId: WorkspaceId, key: string): Promise<JournalEntry | null>;
  saveJournal(entry: JournalEntry, idempotencyKey: string): Promise<void>;
  replaceJournal(entry: JournalEntry, expectedVersion: number): Promise<void>;
}
export interface LedgerTransactionContext { readonly ledger: LedgerRepository }
export type LedgerUnitOfWork = UnitOfWork<LedgerTransactionContext>;
