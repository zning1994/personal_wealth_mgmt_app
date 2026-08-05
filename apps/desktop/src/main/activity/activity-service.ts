import type { ActivityApi, ActivityOperation, ActivityOperationId, WorkspaceId } from "@pwm/contracts";
import type { ActivityInverse, ActivityJournalSnapshot, ActivityLogPort, ActivityRecord, LedgerUnitOfWork } from "@pwm/application";
import type { JournalEntry, Posting } from "@pwm/domain";

export type DesktopActivityService = ActivityApi;

function toPosting(snapshot: ActivityJournalSnapshot["postings"][number]): Posting {
  return {
    id: snapshot.id,
    accountId: snapshot.accountId,
    amount: { currency: snapshot.currency, minor: BigInt(snapshot.amountMinor) },
    role: snapshot.role,
  };
}

function toJournal(snapshot: ActivityJournalSnapshot): JournalEntry {
  return {
    id: snapshot.id,
    workspaceId: snapshot.workspaceId,
    occurredOn: snapshot.occurredOn,
    description: snapshot.description,
    postings: snapshot.postings.map(toPosting),
    version: snapshot.version,
    deletedAt: snapshot.deletedAt,
    transferLinkId: snapshot.transferLinkId,
  };
}

function applySnapshotVersion(snapshot: ActivityJournalSnapshot, version: number): JournalEntry {
  return { ...toJournal(snapshot), version };
}

async function applyInverse(input: {
  readonly inverse: ActivityInverse;
  readonly unitOfWork: LedgerUnitOfWork;
  readonly at: string;
}): Promise<void> {
  await input.unitOfWork.run(async ({ ledger }) => {
    if (input.inverse.kind === "replace-journals" || input.inverse.kind === "restore-journals") {
      if (input.inverse.snapshots.length !== input.inverse.expectedVersions.length) throw new Error("UNDO_INVERSE_INVALID");
      for (let index = 0; index < input.inverse.snapshots.length; index += 1) {
        const snapshot = input.inverse.snapshots[index]!;
        const expectedVersion = input.inverse.expectedVersions[index]!;
        const current = await ledger.findJournalById(snapshot.id);
        if (!current || current.version !== expectedVersion) throw new Error("UNDO_VERSION_CONFLICT");
        await ledger.replaceJournal(applySnapshotVersion(snapshot, current.version + 1), current.version);
      }
      return;
    }
    if (input.inverse.kind === "soft-delete-journals") {
      if (input.inverse.journalIds.length !== input.inverse.expectedVersions.length) throw new Error("UNDO_INVERSE_INVALID");
      for (let index = 0; index < input.inverse.journalIds.length; index += 1) {
        const current = await ledger.findJournalById(input.inverse.journalIds[index]!);
        const expectedVersion = input.inverse.expectedVersions[index]!;
        if (!current || current.version !== expectedVersion) throw new Error("UNDO_VERSION_CONFLICT");
        await ledger.replaceJournal({ ...current, deletedAt: input.at, version: current.version + 1 }, current.version);
      }
      return;
    }
    if (input.inverse.journalIds.length !== 2 || input.inverse.expectedVersions.length !== 2) throw new Error("UNDO_INVERSE_INVALID");
    for (let index = 0; index < 2; index += 1) {
      const current = await ledger.findJournalById(input.inverse.journalIds[index]!);
      const expectedVersion = input.inverse.expectedVersions[index]!;
      if (!current || current.version !== expectedVersion) throw new Error("UNDO_VERSION_CONFLICT");
      await ledger.replaceJournal({ ...current, transferLinkId: input.inverse.linkId, version: current.version + 1 }, current.version);
    }
  });
}

function operationRecord(workspaceId: WorkspaceId, summary: string, original: ActivityOperation, at: string): ActivityOperation {
  return {
    id: crypto.randomUUID() as ActivityOperationId,
    workspaceId,
    kind: "edit",
    entityType: "activity-operation",
    entityId: original.id,
    summary,
    createdAt: at,
    updatedAt: at,
    version: 0,
    deletedAt: null,
    undoable: false,
    undoneAt: null,
    dependsOn: [original.id],
  };
}

export function createDesktopActivityService(input: {
  readonly workspaceId: WorkspaceId;
  readonly log: ActivityLogPort;
  readonly unitOfWork: LedgerUnitOfWork;
  readonly now?: () => string;
}): DesktopActivityService {
  const now = input.now ?? (() => new Date().toISOString());
  return {
    async latest() { return input.log.latest(input.workspaceId); },
    async list(request = {}) { return input.log.list ? input.log.list(input.workspaceId, request.limit) : (await input.log.latest(input.workspaceId) ? [await input.log.latest(input.workspaceId) as ActivityOperation] : []); },
    async undo(request) {
      const record: ActivityRecord | null = request.operationId === undefined
        ? await input.log.latestForUndo?.(input.workspaceId) ?? null
        : await input.log.findForUndo?.(input.workspaceId, request.operationId as ActivityOperationId) ?? null;
      if (!record) throw new Error("UNDO_NOTHING_TO_UNDO");
      const operation = record.operation;
      if (operation.workspaceId !== input.workspaceId) throw new Error("UNDO_WORKSPACE_MISMATCH");
      if (operation.undoneAt) throw new Error("UNDO_ALREADY_APPLIED");
      if (!operation.undoable || !record.inverse || operation.kind === "migration" || operation.kind === "key-operation") throw new Error("UNDO_REQUIRES_RECOVERY");
      if (operation.dependsOn.length > 0) throw new Error("UNDO_HAS_DEPENDENTS");
      await applyInverse({ inverse: record.inverse, unitOfWork: input.unitOfWork, at: now() });
      const undoneAt = now();
      await input.log.markUndone(operation.id, undoneAt);
      if (input.log.append) await input.log.append(operationRecord(input.workspaceId, `Undid: ${operation.summary}`, operation, undoneAt));
      return { ...operation, undoneAt, updatedAt: undoneAt };
    },
  };
}

export function journalSnapshot(entry: JournalEntry): ActivityJournalSnapshot {
  return {
    id: entry.id,
    workspaceId: entry.workspaceId,
    occurredOn: entry.occurredOn,
    description: entry.description,
    postings: entry.postings.map((posting) => ({ id: posting.id, accountId: posting.accountId, amountMinor: posting.amount.minor.toString(), currency: posting.amount.currency, role: posting.role })),
    version: entry.version,
    deletedAt: entry.deletedAt,
    transferLinkId: entry.transferLinkId,
  };
}
