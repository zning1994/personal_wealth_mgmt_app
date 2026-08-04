import type { JournalEntryId } from "@pwm/contracts";
import { linkTransfer, unlinkTransfer } from "@pwm/domain";
import type { LedgerUnitOfWork } from "../ports/ledger-repository";

export class LinkTransferCommand {
  constructor(private readonly unitOfWork: LedgerUnitOfWork) {}
  execute(input: { readonly journalIds: readonly [JournalEntryId, JournalEntryId]; readonly linkId: string }): Promise<void> {
    return this.unitOfWork.run(async ({ ledger }) => {
      const [left, right] = await Promise.all(input.journalIds.map((id) => ledger.findJournalById(id)));
      if (!left || !right) throw new Error("JOURNAL_NOT_FOUND");
      const [nextLeft, nextRight] = linkTransfer(left, right, input.linkId);
      await ledger.replaceJournal(nextLeft, left.version);
      await ledger.replaceJournal(nextRight, right.version);
    });
  }
}

export class UnlinkTransferCommand {
  constructor(private readonly unitOfWork: LedgerUnitOfWork) {}
  execute(input: { readonly journalIds: readonly [JournalEntryId, JournalEntryId] }): Promise<void> {
    return this.unitOfWork.run(async ({ ledger }) => {
      const [left, right] = await Promise.all(input.journalIds.map((id) => ledger.findJournalById(id)));
      if (!left || !right || !left.transferLinkId || left.transferLinkId !== right.transferLinkId) throw new Error("TRANSFER_PAIR_NOT_FOUND");
      await ledger.replaceJournal(unlinkTransfer(left), left.version);
      await ledger.replaceJournal(unlinkTransfer(right), right.version);
    });
  }
}
