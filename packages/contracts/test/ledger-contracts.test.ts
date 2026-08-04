import { describe, expect, it } from "vitest";

import { JournalEntryDtoSchema } from "../src/index";

const UUID = {
  workspace: "00000000-0000-4000-8000-000000000001",
  journal: "00000000-0000-4000-8000-000000000010",
  postingA: "00000000-0000-4000-8000-000000000011",
  postingB: "00000000-0000-4000-8000-000000000012",
  accountA: "00000000-0000-4000-8000-000000000021",
  accountB: "00000000-0000-4000-8000-000000000022",
  quote: "00000000-0000-4000-8000-000000000099",
} as const;

function journalDtoInput() {
  return {
    id: UUID.journal,
    workspaceId: UUID.workspace,
    createdAt: "2026-08-04T10:00:00+04:00",
    updatedAt: "2026-08-04T10:05:00+04:00",
    version: 0,
    deletedAt: null,
    occurredOn: "2026-08-04",
    description: "  Opening balance  ",
    postings: [
      {
        id: UUID.postingA,
        accountId: UUID.accountA,
        amount: { currency: "aed", minor: "-900719925474099300" },
        valuation: {
          currency: "usd",
          minor: "-245000000000000",
          quoteIds: [UUID.quote],
          asOf: "2026-08-04",
        },
        role: "principal",
      },
      {
        id: UUID.postingB,
        accountId: UUID.accountB,
        amount: { currency: "usd", minor: "245000000000000" },
        valuation: {
          currency: "usd",
          minor: "245000000000000",
          quoteIds: [UUID.quote],
          asOf: "2026-08-04",
        },
        role: "fx-clearing",
      },
    ],
  };
}

describe("ledger DTO contracts", () => {
  it("parses decimal-string money into a strict deeply immutable journal DTO", () => {
    const parsed = JournalEntryDtoSchema.parse(journalDtoInput()) as ReturnType<
      typeof journalDtoInput
    >;

    expect(parsed.description).toBe("Opening balance");
    expect(parsed.postings[0]?.amount).toEqual({
      currency: "AED",
      minor: "-900719925474099300",
    });
    expect(parsed.postings[0]?.valuation?.currency).toBe("USD");
    expect(JSON.stringify(parsed)).toContain('"minor":"-900719925474099300"');
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.postings)).toBe(true);
    expect(Object.isFrozen(parsed.postings[0])).toBe(true);
    expect(Object.isFrozen(parsed.postings[0]?.amount)).toBe(true);
    expect(Object.isFrozen(parsed.postings[0]?.valuation)).toBe(true);
    expect(Object.isFrozen(parsed.postings[0]?.valuation?.quoteIds)).toBe(true);
  });

  it("rejects unknown fields at journal and posting boundaries", () => {
    expect(() =>
      JournalEntryDtoSchema.parse({ ...journalDtoInput(), hidden: true }),
    ).toThrow();

    const input = journalDtoInput();
    input.postings[0] = { ...input.postings[0], hidden: true } as never;
    expect(() => JournalEntryDtoSchema.parse(input)).toThrow();
  });

  it("rejects duplicate posting IDs and whitespace-only descriptions", () => {
    const duplicate = journalDtoInput();
    duplicate.postings[1].id = duplicate.postings[0].id;
    expect(() => JournalEntryDtoSchema.parse(duplicate)).toThrow("posting ID");

    expect(() =>
      JournalEntryDtoSchema.parse({ ...journalDtoInput(), description: " \t " }),
    ).toThrow();
  });
});
