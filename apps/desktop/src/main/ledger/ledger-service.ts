import type { LedgerApi, LedgerJournalView, ListLedgerInput, TransferSuggestion, DeleteJournalInput, LinkTransferInput, UnlinkTransferInput, LedgerPostingView, UpdateJournalInput, ClassifyJournalInput, MergeJournalInput } from "@pwm/contracts";
import type { ActivityInverse, ActivityLogPort, LedgerRepository, LedgerUnitOfWork } from "@pwm/application";
import { assertBalanced, linkTransfer, replaceJournal, unlinkTransfer, type JournalEntry, type Posting } from "@pwm/domain";
import { scoreInternalTransferPair } from "@pwm/domain";
import type { WorkspaceId } from "@pwm/contracts";
import { journalSnapshot } from "../activity/activity-service";

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
  const record = async (kind: "edit" | "classification" | "merge" | "delete", entityType: string, entityId: string, summary: string, inverse: ActivityInverse | null = null): Promise<void> => {
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
      undoable: inverse !== null,
      undoneAt: null,
      dependsOn: [],
    }, inverse);
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
      const previous = await input.unitOfWork.run(async ({ ledger }) => {
        const current = await ledger.findJournalById(request.id);
        if (!current || current.workspaceId !== input.workspaceId) throw new Error("JOURNAL_NOT_FOUND");
        if (current.version !== request.expectedVersion) throw new Error("VERSION_CONFLICT");
        await ledger.replaceJournal({ ...current, deletedAt: now(), version: current.version + 1 }, request.expectedVersion);
        return current;
      });
      await record("delete", "journal", request.id, "Deleted journal entry", { kind: "restore-journals", snapshots: [journalSnapshot(previous)], expectedVersions: [previous.version + 1] });
    },
    async update(request: UpdateJournalInput): Promise<void> {
      const previous = await input.unitOfWork.run(async ({ ledger }) => {
        const current = await ledger.findJournalById(request.id);
        if (!current || current.workspaceId !== input.workspaceId) throw new Error("JOURNAL_NOT_FOUND");
        if (current.version !== request.expectedVersion) throw new Error("VERSION_CONFLICT");
        const postings = request.postings.map((posting) => ({ id: posting.id ?? crypto.randomUUID() as never, accountId: posting.accountId, amount: { currency: posting.currency, minor: BigInt(posting.amountMinor) }, role: posting.role }));
        assertBalanced(postings);
        await ledger.replaceJournal({ ...replaceJournal(current, postings), occurredOn: request.occurredOn, description: request.description.trim() }, current.version);
        return current;
      });
      await record("edit", "journal", request.id, "Edited journal entry", { kind: "replace-journals", snapshots: [journalSnapshot(previous)], expectedVersions: [previous.version + 1] });
    },
    async classify(request: ClassifyJournalInput): Promise<void> {
      const previous = await input.unitOfWork.run(async ({ ledger }) => {
        const current = await ledger.findJournalById(request.id);
        if (!current || current.workspaceId !== input.workspaceId) throw new Error("JOURNAL_NOT_FOUND");
        if (current.version !== request.expectedVersion) throw new Error("VERSION_CONFLICT");
        const categoryIndex = current.postings.findIndex((posting) => posting.role === "category") >= 0
          ? current.postings.findIndex((posting) => posting.role === "category")
          : current.postings.length - 1;
        const postings = current.postings.map((posting, index) => index === categoryIndex ? { ...posting, accountId: request.categoryAccountId, role: "category" as const } : posting);
        await ledger.replaceJournal(replaceJournal(current, postings), current.version);
        return current;
      });
      await record("classification", "journal", request.id, "Changed journal category", { kind: "replace-journals", snapshots: [journalSnapshot(previous)], expectedVersions: [previous.version + 1] });
    },
    async merge(request: MergeJournalInput): Promise<void> {
      const previous = await input.unitOfWork.run(async ({ ledger }) => {
        const survivor = await ledger.findJournalById(request.survivorId);
        const duplicate = await ledger.findJournalById(request.duplicateId);
        if (!survivor || !duplicate || survivor.workspaceId !== input.workspaceId || duplicate.workspaceId !== input.workspaceId) throw new Error("JOURNAL_NOT_FOUND");
        if (survivor.version !== request.survivorExpectedVersion || duplicate.version !== request.duplicateExpectedVersion) throw new Error("VERSION_CONFLICT");
        if (duplicate.deletedAt !== null) throw new Error("JOURNAL_ALREADY_DELETED");
        if (duplicate.transferLinkId !== null) throw new Error("MERGE_LINKED_TRANSFER_UNSUPPORTED");
        await ledger.replaceJournal({ ...duplicate, deletedAt: now(), version: duplicate.version + 1 }, duplicate.version);
        return duplicate;
      });
      await record("merge", "journal", request.duplicateId, "Merged duplicate journal entry", { kind: "restore-journals", snapshots: [journalSnapshot(previous)], expectedVersions: [previous.version + 1] });
    },
  async linkTransfer(request: LinkTransferInput): Promise<void> {
    const previous = await input.unitOfWork.run(async ({ ledger }) => {
      const [left, right] = await Promise.all(request.journalIds.map((id) => ledger.findJournalById(id)));
      if (!left || !right || left.workspaceId !== input.workspaceId || right.workspaceId !== input.workspaceId) throw new Error("JOURNAL_NOT_FOUND");
      const [nextLeft, nextRight] = linkTransfer(left, right, request.linkId);
      await ledger.replaceJournal(nextLeft, left.version);
      await ledger.replaceJournal(nextRight, right.version);
      return [left, right] as const;
    });
    await record("edit", "transfer", request.journalIds[0], "Linked internal transfer pair", { kind: "set-transfer-link", journalIds: request.journalIds, linkId: null, expectedVersions: [previous[0].version + 1, previous[1].version + 1] });
    },
  async unlinkTransfer(request: UnlinkTransferInput): Promise<void> {
    const previous = await input.unitOfWork.run(async ({ ledger }) => {
      const [left, right] = await Promise.all(request.journalIds.map((id) => ledger.findJournalById(id)));
      if (!left || !right || left.workspaceId !== input.workspaceId || right.workspaceId !== input.workspaceId) throw new Error("JOURNAL_NOT_FOUND");
      if (!left.transferLinkId || left.transferLinkId !== right.transferLinkId) throw new Error("TRANSFER_PAIR_NOT_FOUND");
      await ledger.replaceJournal(unlinkTransfer(left), left.version);
      await ledger.replaceJournal(unlinkTransfer(right), right.version);
      return [left, right] as const;
    });
    await record("edit", "transfer", request.journalIds[0], "Unlinked internal transfer pair", { kind: "set-transfer-link", journalIds: request.journalIds, linkId: previous[0].transferLinkId, expectedVersions: [previous[0].version + 1, previous[1].version + 1] });
    },
  };
}

export function createInMemoryLedgerUnitOfWork(): LedgerUnitOfWork {
  const entries: JournalEntry[] = [];
  const repository: LedgerRepository = {
    async findJournalById(id) { return entries.find((entry) => entry.id === id) ?? null; },
    async listJournals(currentWorkspaceId, input = {}) { return entries.filter((entry) => entry.workspaceId === currentWorkspaceId && (input.includeDeleted || entry.deletedAt === null) && (input.from === undefined || entry.occurredOn >= input.from) && (input.to === undefined || entry.occurredOn <= input.to)); },
    async findJournalByIdempotencyKey() { return null; },
    async saveJournal(entry) { entries.push(entry); },
    async replaceJournal(entry, expectedVersion) { const index = entries.findIndex((candidate) => candidate.id === entry.id && candidate.version === expectedVersion); if (index < 0) throw new Error("VERSION_CONFLICT"); entries[index] = entry; },
  };
  return { run: async <T>(work: (context: { ledger: LedgerRepository }) => Promise<T>) => work({ ledger: repository }) };
}

export function createInMemoryLedgerService(workspaceId: WorkspaceId, activity?: ActivityLogPort, unitOfWork: LedgerUnitOfWork = createInMemoryLedgerUnitOfWork()): DesktopLedgerService {
  return createDesktopLedgerService({ workspaceId, unitOfWork, ...(activity === undefined ? {} : { activity }) });
}
