import type { AccountId, Currency, ImportBatchId, JournalEntryId, PostingId, RawRecordId, WorkspaceId } from "@pwm/contracts";
import { createJournal, type JournalEntry } from "@pwm/domain";

export type ImportPostingDraft = { accountId: string; amountMinor: bigint; currency: Currency };
export type ImportJournalDraft = { rawRecordIds: readonly string[]; occurredOn: string; description: string; postings: readonly ImportPostingDraft[] };
export type ImportCommitRequest = { workspaceId: string; batchId: string; sourceSha256: string; idempotencyKey: string; entries: readonly ImportJournalDraft[] };
export type ImportCommitResult = { batchId: string; journalIds: readonly string[] };
export interface ImportLedgerWriter { saveJournal(journal: JournalEntry, sourceKey: string): Promise<void> }
export interface ImportBatchWriteRepository { findCommit(workspaceId: WorkspaceId, key: string): Promise<ImportCommitResult | null>; findSourceCommit?(workspaceId: WorkspaceId, sourceSha256: string): Promise<ImportCommitResult | null>; linkRawRecord(journalId: JournalEntryId, rawRecordId: RawRecordId): Promise<void>; markCommitted(batchId: ImportBatchId, result: ImportCommitResult, key: string, sourceSha256?: string): Promise<void> }
export interface ImportCommitTransaction { ledger: ImportLedgerWriter; imports: ImportBatchWriteRepository }
export interface ImportCommitUnitOfWork { run<T>(work: (transaction: ImportCommitTransaction) => Promise<T>): Promise<T> }

export class CommitImportBatchCommand {
  constructor(private readonly unitOfWork: ImportCommitUnitOfWork, private readonly ids: { journal(): JournalEntryId; posting(): PostingId }) {}
  async execute(request: ImportCommitRequest): Promise<ImportCommitResult> {
    if (request.entries.length === 0) throw new Error("EMPTY_IMPORT_BATCH");
    for (const entry of request.entries) {
      if (entry.postings.length < 2) throw new Error("UNBALANCED_IMPORT_ENTRY");
      const totals = new Map<Currency, bigint>(); for (const posting of entry.postings) totals.set(posting.currency, (totals.get(posting.currency) ?? 0n) + posting.amountMinor);
      if ([...totals.values()].some((total) => total !== 0n)) throw new Error("UNBALANCED_IMPORT_ENTRY");
    }
    return this.unitOfWork.run(async ({ ledger, imports }) => {
      const existing = await imports.findCommit(request.workspaceId as WorkspaceId, request.idempotencyKey); if (existing) return existing;
      const sourceExisting = await imports.findSourceCommit?.(request.workspaceId as WorkspaceId, request.sourceSha256);
      if (sourceExisting) throw new Error("IMPORT_SOURCE_ALREADY_COMMITTED");
      const journalIds: string[] = [];
      for (const [entryIndex, entry] of request.entries.entries()) {
        const journal = createJournal({ id: this.ids.journal(), workspaceId: request.workspaceId as WorkspaceId, occurredOn: entry.occurredOn, description: entry.description, postings: entry.postings.map((posting) => ({ id: this.ids.posting(), accountId: posting.accountId as AccountId, amount: { currency: posting.currency, minor: posting.amountMinor }, role: "principal" as const })) });
        await ledger.saveJournal(journal, `${request.idempotencyKey}:${entryIndex}`); journalIds.push(journal.id);
        for (const rawRecordId of entry.rawRecordIds) await imports.linkRawRecord(journal.id, rawRecordId as RawRecordId);
      }
      const result: ImportCommitResult = { batchId: request.batchId, journalIds }; await imports.markCommitted(request.batchId as ImportBatchId, result, request.idempotencyKey, request.sourceSha256); return result;
    });
  }
}
