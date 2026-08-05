import { describe, expect, it } from "vitest";
import type { ActivityInverse, ActivityLogPort, ActivityRecord, LedgerRepository, LedgerUnitOfWork } from "@pwm/application";
import type { ActivityOperation, WorkspaceId } from "@pwm/contracts";
import { createJournal, type JournalEntry } from "@pwm/domain";
import { createDesktopActivityService, journalSnapshot } from "./activity-service";

const workspace = "018f4f7e-8ead-7c0d-0000-000000000001" as WorkspaceId;
const journalId = "018f4f7e-8ead-7c0d-0000-000000000002" as never;

function entry(): JournalEntry {
  return createJournal({ id: journalId, workspaceId: workspace, occurredOn: "2026-08-05", description: "Before", postings: [
    { id: "018f4f7e-8ead-7c0d-0000-000000000003" as never, accountId: "018f4f7e-8ead-7c0d-0000-000000000004" as never, amount: { currency: "AED" as never, minor: -100n }, role: "principal" },
    { id: "018f4f7e-8ead-7c0d-0000-000000000005" as never, accountId: "018f4f7e-8ead-7c0d-0000-000000000006" as never, amount: { currency: "AED" as never, minor: 100n }, role: "category" },
  ] });
}

function operation(): ActivityOperation {
  return { id: "018f4f7e-8ead-7c0d-0000-000000000007" as never, workspaceId: workspace, kind: "edit", entityType: "journal", entityId: journalId, summary: "Edit", createdAt: "2026-08-05T00:00:00.000Z", updatedAt: "2026-08-05T00:00:00.000Z", version: 0, deletedAt: null, undoable: true, undoneAt: null, dependsOn: [] };
}

function harness(current: JournalEntry, record: ActivityRecord) {
  let value = current;
  const repository: LedgerRepository = {
    findJournalById: async (id) => id === value.id ? value : null,
    listJournals: async () => [value],
    findJournalByIdempotencyKey: async () => null,
    saveJournal: async () => undefined,
    replaceJournal: async (next, expectedVersion) => { if (value.version !== expectedVersion) throw new Error("UNDO_VERSION_CONFLICT"); value = next; },
  };
  const unitOfWork: LedgerUnitOfWork = { run: async (work) => work({ ledger: repository }) };
  const records: ActivityRecord[] = [record];
  const log: ActivityLogPort = {
    latest: async () => records[0]?.operation ?? null,
    latestForUndo: async () => records.find((candidate) => candidate.operation.undoable && !candidate.operation.undoneAt) ?? null,
    findForUndo: async (_workspace, id) => records.find((candidate) => candidate.operation.id === id) ?? null,
    append: async (next, inverse) => { records.unshift({ operation: next, inverse: inverse ?? null }); },
    markUndone: async (id, at) => { const index = records.findIndex((candidate) => candidate.operation.id === id); if (index >= 0) records[index] = { ...records[index]!, operation: { ...records[index]!.operation, undoneAt: at, updatedAt: at } }; },
  };
  return { service: createDesktopActivityService({ workspaceId: workspace, log, unitOfWork, now: () => "2026-08-05T01:00:00.000Z" }), get current() { return value; }, records };
}

describe("desktop activity service", () => {
  it("restores an edited journal and appends a non-undoable undo marker", async () => {
    const before = entry();
    const after = { ...before, description: "After", version: 1 };
    const inverse: ActivityInverse = { kind: "replace-journals", snapshots: [journalSnapshot(before)], expectedVersions: [1] };
    const value = harness(after, { operation: operation(), inverse });
    await expect(value.service.undo({ operationId: operation().id })).resolves.toMatchObject({ undoneAt: "2026-08-05T01:00:00.000Z" });
    expect(value.current.description).toBe("Before");
    expect(value.current.version).toBe(2);
    expect(value.records[0]?.operation.undoable).toBe(false);
  });

  it("rejects a version conflict rather than overwriting a later edit", async () => {
    const before = entry();
    const inverse: ActivityInverse = { kind: "replace-journals", snapshots: [journalSnapshot(before)], expectedVersions: [1] };
    const current = { ...before, description: "Later", version: 2 };
    const value = harness(current, { operation: operation(), inverse });
    await expect(value.service.undo({ operationId: operation().id })).rejects.toThrow("UNDO_VERSION_CONFLICT");
  });
});
