import type { LedgerApi, LedgerJournalView, ListLedgerInput, TransferSuggestion, DeleteJournalInput, LinkTransferInput, UnlinkTransferInput, LedgerPostingView } from "@pwm/contracts";
import { LinkTransferCommand, UnlinkTransferCommand, type ActivityLogPort, type LedgerRepository, type LedgerUnitOfWork } from "@pwm/application";
import type { JournalEntry, Posting } from "@pwm/domain";
import { scoreInternalTransferPair } from "@pwm/domain";
import type { WorkspaceId } from "@pwm/contracts";

export type DesktopLedgerService = LedgerApi;

function postingView(posting: Posting): LedgerPostingView {
  return { id: posting.id, accountId: posting.accountId, amountMinor: posting.amount.minor.toString() as LedgerPostingView["amountMinor"], currency: posting.amount.currency, role: posting.role };
}

function journalView(entry: JournalEntry): LedgerJournalView {
  return { id: entry.id, workspaceId: entry.workspaceId, occurredOn: entry.occurredOn, description: entry.description, postings: entry.postings.map(postingView), version: entry.version, deletedAt: entry.deletedAt, transferLinkId: entry.transferLinkId as string | null };
}

function transferCandidate(entry: JournalEntry) {
  const principal = entry.postings.find((posting) => posting.role === "principal") ?? entry.postings[0];
  if (!principal) return null;
  const feeMinor = entry.postings.filter((posting) => posting.role === "fee").reduce((total, posting) => total + posting.amount.minor, 0n);
  return { accountId: principal.accountId, date: entry.occurredOn, currency: principal.amount.currency, minor: principal.amount.minor, description: entry.description, reference: null, principalValuation: principal.valuation ? { currency: principal.valuation.currency, minor: principal.valuation.minor } : null, feeMinor };
}

function requireList(ledger: LedgerRepository): NonNullable<LedgerRepository["listJournals"]> {
  if (!ledger.listJournals) throw new Error("LEDGER_LIST_UNAVAILABLE");
  return ledger.listJournals.bind(ledger);
}

export function createDesktopLedgerService(input: { workspaceId: WorkspaceId; unitOfWork: LedgerUnitOfWork; activity?: ActivityLogPort; now?: () => string }): DesktopLedgerService {
  const now = input.now ?? (() => new Date().toISOString());
  const link = new LinkTransferCommand(input.unitOfWork);
  const unlink = new UnlinkTransferCommand(input.unitOfWork);
  const record = async (kind: "edit" | "delete", entityType: string, entityId: string, summary: string): Promise<void> => {
    if (!input.activity?.append) return;
    const timestamp = now();
    await input.activity.append({
      id: crypto.randomUUID() as never,
      workspaceId: input.workspaceId,
      kind,
      entityType,
      entityId,
      summary,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 0,
      deletedAt: null,
      undoable: false,
      undoneAt: null,
      dependsOn: [],
    });
  };
  return {
    async list(rawInput: ListLedgerInput = {}) {
      const parsed = { ...rawInput, includeDeleted: rawInput.includeDeleted ?? false };
      const query = { ...(parsed.from === undefined ? {} : { from: parsed.from }), ...(parsed.to === undefined ? {} : { to: parsed.to }), includeDeleted: parsed.includeDeleted };
      return input.unitOfWork.run(async ({ ledger }) => (await requireList(ledger)(input.workspaceId, query)).map(journalView));
    },
    async suggestions(): Promise<readonly TransferSuggestion[]> {
      return input.unitOfWork.run(async ({ ledger }) => {
        const entries = (await requireList(ledger)(input.workspaceId)).filter((entry) => entry.deletedAt === null && entry.transferLinkId === null);
        const suggestions: TransferSuggestion[] = [];
        for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
          const left = entries[leftIndex]!;
          const leftCandidate = transferCandidate(left);
          if (!leftCandidate) continue;
          for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
            const right = entries[rightIndex]!;
            const rightCandidate = transferCandidate(right);
            if (!rightCandidate) continue;
            const score = scoreInternalTransferPair(leftCandidate, rightCandidate);
            if (score.score < 50) continue;
            suggestions.push({ leftJournalId: left.id, rightJournalId: right.id, score: Math.min(100, score.score), reasons: [...score.reasons] });
          }
        }
        return suggestions.sort((left, right) => right.score - left.score);
      });
    },
    async delete(request: DeleteJournalInput): Promise<void> {
      await input.unitOfWork.run(async ({ ledger }) => {
        const current = await ledger.findJournalById(request.id);
        if (!current || current.workspaceId !== input.workspaceId) throw new Error("JOURNAL_NOT_FOUND");
        if (current.version !== request.expectedVersion) throw new Error("VERSION_CONFLICT");
        await ledger.replaceJournal({ ...current, deletedAt: now(), version: current.version + 1 }, request.expectedVersion);
      });
      await record("delete", "journal", request.id, "Deleted journal entry");
    },
  async linkTransfer(request: LinkTransferInput): Promise<void> {
    await link.execute({ journalIds: request.journalIds, linkId: request.linkId });
    await record("edit", "transfer", request.linkId, "Linked internal transfer pair");
    },
  async unlinkTransfer(request: UnlinkTransferInput): Promise<void> {
    await unlink.execute({ journalIds: request.journalIds });
    await record("edit", "transfer", request.journalIds[0], "Unlinked internal transfer pair");
    },
  };
}

export function createInMemoryLedgerService(workspaceId: WorkspaceId, activity?: ActivityLogPort): DesktopLedgerService {
  const entries: JournalEntry[] = [];
  const repository: LedgerRepository = {
    async findJournalById(id) { return entries.find((entry) => entry.id === id) ?? null; },
    async listJournals(currentWorkspaceId, input = {}) { return entries.filter((entry) => entry.workspaceId === currentWorkspaceId && (input.includeDeleted || entry.deletedAt === null) && (input.from === undefined || entry.occurredOn >= input.from) && (input.to === undefined || entry.occurredOn <= input.to)); },
    async findJournalByIdempotencyKey() { return null; },
    async saveJournal(entry) { entries.push(entry); },
    async replaceJournal(entry, expectedVersion) { const index = entries.findIndex((candidate) => candidate.id === entry.id && candidate.version === expectedVersion); if (index < 0) throw new Error("VERSION_CONFLICT"); entries[index] = entry; },
  };
  const unitOfWork: LedgerUnitOfWork = { run: async <T>(work: (context: { ledger: LedgerRepository }) => Promise<T>) => work({ ledger: repository }) };
  return createDesktopLedgerService({ workspaceId, unitOfWork, ...(activity === undefined ? {} : { activity }) });
}
