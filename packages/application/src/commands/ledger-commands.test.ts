import { describe, expect, it } from "vitest";
import type { JournalEntryId, WorkspaceId } from "@pwm/contracts";
import type { JournalEntry } from "@pwm/domain";
import { LinkTransferCommand, PostJournalCommand } from "../index";
import type { LedgerRepository, LedgerUnitOfWork } from "../ports/ledger-repository";

class MemoryLedger implements LedgerRepository, LedgerUnitOfWork {
  readonly journals: JournalEntry[] = [];
  private readonly keys = new Map<string, JournalEntryId>();
  async run<T>(work: (context: { ledger: LedgerRepository }) => Promise<T>): Promise<T> { return work({ ledger: this }); }
  async findJournalById(id: JournalEntryId): Promise<JournalEntry | null> { return this.journals.find((entry) => entry.id === id) ?? null; }
  async findJournalByIdempotencyKey(workspaceId: WorkspaceId, key: string): Promise<JournalEntry | null> { const id = this.keys.get(`${workspaceId}:${key}`); return id ? this.findJournalById(id) : null; }
  async saveJournal(entry: JournalEntry, idempotencyKey: string): Promise<void> { this.journals.push(entry); this.keys.set(`${entry.workspaceId}:${idempotencyKey}`, entry.id); }
  async replaceJournal(entry: JournalEntry, expectedVersion: number): Promise<void> { const index = this.journals.findIndex((candidate) => candidate.id === entry.id && candidate.version === expectedVersion); if (index < 0) throw new Error("VERSION_CONFLICT"); this.journals[index] = entry; }
}

const workspace = "00000000-0000-4000-8000-000000000001" as never;
const left = "00000000-0000-4000-8000-000000000101" as never;
const right = "00000000-0000-4000-8000-000000000102" as never;

function journal(id: JournalEntryId, account: string, category: string, amount: bigint): JournalEntry {
  return { id, workspaceId: workspace, occurredOn: "2026-08-05", description: "Synthetic transfer", postings: [{ id: `${id}-1` as never, accountId: account as never, amount: { currency: "AED" as never, minor: amount }, role: "principal" }, { id: `${id}-2` as never, accountId: category as never, amount: { currency: "AED" as never, minor: -amount }, role: "category" }], version: 0, deletedAt: null, transferLinkId: null };
}

describe("ledger commands", () => {
  it("is idempotent and links both journals in one unit of work", async () => {
    const ledger = new MemoryLedger();
    const post = new PostJournalCommand(ledger);
    const input = { id: left, workspaceId: workspace, occurredOn: "2026-08-05", description: "Synthetic", idempotencyKey: "import:one", postings: journal(left, "00000000-0000-4000-8000-000000000201", "00000000-0000-4000-8000-000000000202", -100n).postings };
    const first = await post.execute(input);
    const second = await post.execute({ ...input, id: right });
    expect(second.id).toBe(first.id);
    ledger.journals.push(journal(right, "00000000-0000-4000-8000-000000000203", "00000000-0000-4000-8000-000000000204", 100n));
    await new LinkTransferCommand(ledger).execute({ journalIds: [left, right], linkId: "00000000-0000-4000-8000-000000000301" });
    expect(ledger.journals.map((entry) => entry.transferLinkId)).toEqual(["00000000-0000-4000-8000-000000000301", "00000000-0000-4000-8000-000000000301"]);
  });
});
