import { describe, expect, it } from "vitest";
import { CommitImportBatchCommand, type ImportCommitResult, type ImportCommitTransaction } from "./commit-import-batch";
import type { Currency, JournalEntryId, PostingId } from "@pwm/contracts";

function ids() { let journal = 0; let posting = 0; return { journal: () => `00000000-0000-4000-8000-${String(++journal).padStart(12, "0")}` as JournalEntryId, posting: () => `00000000-0000-4000-8000-${String(++posting).padStart(12, "0")}` as PostingId }; }
function unitOfWork() {
  const commits = new Map<string, ImportCommitResult>(); const journals: unknown[] = []; let runCount = 0;
  const unitOfWork = { run: async <T>(work: (transaction: ImportCommitTransaction) => Promise<T>) => { runCount += 1; return work({ ledger: { saveJournal: async (journal) => { journals.push(journal); } }, imports: { findCommit: async (_workspace, key) => commits.get(key) ?? null, linkRawRecord: async () => undefined, markCommitted: async (_batch, result, key) => { commits.set(key, result); } } }); } };
  return { unitOfWork, journals, commits, get runCount() { return runCount; } };
}
const request = (idempotencyKey = crypto.randomUUID()) => ({ workspaceId: "018f8f19-2d6a-7b00-8000-000000000099", batchId: crypto.randomUUID(), idempotencyKey, entries: [{ rawRecordIds: [crypto.randomUUID()], occurredOn: "2026-08-04", description: "Synthetic Market", postings: [{ accountId: crypto.randomUUID(), amountMinor: -1000n, currency: "AED" as Currency }, { accountId: crypto.randomUUID(), amountMinor: 1000n, currency: "AED" as Currency }] }] });
describe("CommitImportBatchCommand", () => {
  it("commits once for a repeated idempotency key", async () => { const state = unitOfWork(); const command = new CommitImportBatchCommand(state.unitOfWork, ids()); const input = request(); const first = await command.execute(input); const second = await command.execute(input); expect(second).toEqual(first); expect(state.journals).toHaveLength(1); expect(state.runCount).toBe(2); });
  it("rejects an unbalanced entry before starting a transaction", async () => { const state = unitOfWork(); const command = new CommitImportBatchCommand(state.unitOfWork, ids()); await expect(command.execute({ ...request(), entries: [{ ...request().entries[0]!, postings: [{ accountId: crypto.randomUUID(), amountMinor: 1n, currency: "AED" as Currency }] }] })).rejects.toThrow("UNBALANCED_IMPORT_ENTRY"); expect(state.runCount).toBe(0); });
});
