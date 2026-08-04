import { describe, expect, it } from "vitest";
import { createJournal, type JournalEntry } from "@pwm/domain";
import type { LedgerRepository, LedgerUnitOfWork } from "@pwm/application";
import { createDesktopLedgerService } from "./ledger-service";

const workspaceId = "018f4f7e-8ead-7c0d-0000-000000000001" as never;
const accountA = "018f4f7e-8ead-7c0d-0000-000000000002" as never;
const accountB = "018f4f7e-8ead-7c0d-0000-000000000003" as never;

function entry(id: string, amount: bigint, date: string, description: string): JournalEntry {
  return createJournal({ id: id as never, workspaceId, occurredOn: date, description, postings: [
    { id: `${id.slice(0, 35)}1` as never, accountId: accountA, amount: { currency: "AED" as never, minor: amount }, role: "principal" },
    { id: `${id.slice(0, 35)}2` as never, accountId: accountB, amount: { currency: "AED" as never, minor: -amount }, role: "category" },
  ]});
}

function harness(initial: JournalEntry[]) {
  const entries = [...initial];
  const repository: LedgerRepository = {
    findJournalById: async (id) => entries.find((item) => item.id === id) ?? null,
    listJournals: async (currentWorkspaceId) => entries.filter((item) => item.workspaceId === currentWorkspaceId && item.deletedAt === null),
    findJournalByIdempotencyKey: async () => null,
    saveJournal: async (item) => { entries.push(item); },
    replaceJournal: async (item, expectedVersion) => { const index = entries.findIndex((candidate) => candidate.id === item.id && candidate.version === expectedVersion); if (index < 0) throw new Error("VERSION_CONFLICT"); entries[index] = item; },
  };
  const unitOfWork: LedgerUnitOfWork = { run: async <T>(work: (context: { ledger: LedgerRepository }) => Promise<T>) => work({ ledger: repository }) };
  return { service: createDesktopLedgerService({ workspaceId, unitOfWork, now: () => "2026-08-05T00:00:00.000Z" }), entries };
}

describe("desktop ledger service", () => {
  it("suggests opposite transactions and links them only after explicit action", async () => {
    const left = entry("018f4f7e-8ead-7c0d-0000-000000000011", -10000n, "2026-08-04", "Transfer to savings");
    const right = entry("018f4f7e-8ead-7c0d-0000-000000000012", 10000n, "2026-08-05", "Transfer from checking");
    const harnessValue = harness([left, right]);
    await expect(harnessValue.service.suggestions()).resolves.toMatchObject([{ score: expect.any(Number), leftJournalId: left.id, rightJournalId: right.id }]);
    await harnessValue.service.linkTransfer({ journalIds: [left.id, right.id], linkId: "018f4f7e-8ead-7c0d-0000-000000000013" });
    expect(harnessValue.entries.map((item) => item.transferLinkId)).toEqual(["018f4f7e-8ead-7c0d-0000-000000000013", "018f4f7e-8ead-7c0d-0000-000000000013"]);
    await harnessValue.service.unlinkTransfer({ journalIds: [left.id, right.id] });
    expect(harnessValue.entries.map((item) => item.transferLinkId)).toEqual([null, null]);
  });

  it("soft-deletes with optimistic version checking", async () => {
    const value = entry("018f4f7e-8ead-7c0d-0000-000000000021", -100n, "2026-08-05", "Synthetic purchase");
    const harnessValue = harness([value]);
    await harnessValue.service.delete({ id: value.id, expectedVersion: 0 });
    expect(harnessValue.entries[0]).toMatchObject({ deletedAt: "2026-08-05T00:00:00.000Z", version: 1 });
    await expect(harnessValue.service.delete({ id: value.id, expectedVersion: 0 })).rejects.toThrow("VERSION_CONFLICT");
  });
});
