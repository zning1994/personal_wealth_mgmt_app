import { createJournal, type CreateJournalInput, type JournalEntry } from "@pwm/domain";
import type { LedgerUnitOfWork } from "../ports/ledger-repository";

export class PostJournalCommand {
  constructor(private readonly unitOfWork: LedgerUnitOfWork) {}
  execute(input: CreateJournalInput & { readonly idempotencyKey: string }): Promise<JournalEntry> {
    return this.unitOfWork.run(async ({ ledger }) => {
      const existing = await ledger.findJournalByIdempotencyKey(input.workspaceId, input.idempotencyKey);
      if (existing) return existing;
      const journal = createJournal(input);
      await ledger.saveJournal(journal, input.idempotencyKey);
      return journal;
    });
  }
}
