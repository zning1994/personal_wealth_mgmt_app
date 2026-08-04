import { describe, expect, it } from "vitest";

import type {
  AccountId,
  Currency,
  JournalEntryId,
  PostingId,
  WorkspaceId,
} from "@pwm/contracts";

import type { CreateJournalInput } from "../src/index";
import { assertBalanced, createJournal, replaceJournal } from "../src/index";

type PostingRole = "principal" | "fee" | "fx-clearing" | "category";
type MutablePosting = {
  id: PostingId;
  accountId: AccountId;
  amount: { currency: Currency; minor: bigint };
  valuation?: {
    currency: Currency;
    minor: bigint;
    quoteIds: string[];
    asOf: string;
  };
  role: PostingRole;
};
const workspaceId = "00000000-0000-4000-8000-000000000001" as WorkspaceId;
const journalId = "00000000-0000-4000-8000-000000000010" as JournalEntryId;
const accountA = "00000000-0000-4000-8000-000000000021" as AccountId;
const accountB = "00000000-0000-4000-8000-000000000022" as AccountId;
const accountC = "00000000-0000-4000-8000-000000000023" as AccountId;
const quoteId = "00000000-0000-4000-8000-000000000099";
const currency = (value: string): Currency => value as Currency;
const postingId = (suffix: string): PostingId =>
  `00000000-0000-4000-8000-${suffix.padStart(12, "0")}` as PostingId;

function posting(
  id: PostingId,
  accountId: AccountId,
  currencyCode: string,
  minor: bigint,
  role: PostingRole = "principal",
): MutablePosting {
  return {
    id,
    accountId,
    amount: { currency: currency(currencyCode), minor },
    role,
  };
}

function valuedPosting(
  id: PostingId,
  accountId: AccountId,
  currencyCode: string,
  minor: bigint,
  valuationCurrency: string,
  valuationMinor: bigint,
  role: PostingRole = "principal",
): MutablePosting {
  return {
    ...posting(id, accountId, currencyCode, minor, role),
    valuation: {
      currency: currency(valuationCurrency),
      minor: valuationMinor,
      quoteIds: [quoteId],
      asOf: "2026-08-04",
    },
  };
}

function input(postings: MutablePosting[]): CreateJournalInput {
  return {
    id: journalId,
    workspaceId,
    occurredOn: "2026-08-04",
    description: "  FX transfer  ",
    postings,
  };
}

describe("journal balance", () => {
  it("balances a cross-currency transfer with an explicit fee posting", () => {
    const entry = createJournal(
      input([
        valuedPosting(postingId("11"), accountA, "USD", -10_200n, "EUR", -9_384n),
        valuedPosting(postingId("12"), accountB, "EUR", 9_200n, "EUR", 9_200n),
        valuedPosting(postingId("13"), accountC, "USD", 200n, "EUR", 184n, "fee"),
      ]),
    );

    expect(entry.postings).toHaveLength(3);
    expect(entry.description).toBe("FX transfer");
  });

  it("accepts an exact single-currency journal without valuations", () => {
    expect(() =>
      assertBalanced([
        posting(postingId("14"), accountA, "AED", -(10n ** 30n)),
        posting(postingId("15"), accountB, "AED", 10n ** 30n),
      ]),
    ).not.toThrow();
  });

  it("requires at least two postings", () => {
    expect(() =>
      createJournal(input([posting(postingId("16"), accountA, "AED", 0n)])),
    ).toThrow("at least two postings");
  });

  it("rejects an unbalanced single-currency journal", () => {
    expect(() =>
      createJournal(
        input([
          posting(postingId("17"), accountA, "AED", -100n),
          posting(postingId("18"), accountB, "AED", 99n),
        ]),
      ),
    ).toThrow("Unbalanced AED: -1");
  });

  it("requires valuations on every posting in mixed-currency mode", () => {
    expect(() =>
      createJournal(
        input([
          valuedPosting(postingId("19"), accountA, "USD", -100n, "AED", -367n),
          posting(postingId("20"), accountB, "AED", 367n),
        ]),
      ),
    ).toThrow("require valuations");
  });

  it("requires valuations on every posting when any same-currency posting is valued", () => {
    expect(() =>
      createJournal(
        input([
          valuedPosting(postingId("21"), accountA, "AED", -100n, "AED", -100n),
          posting(postingId("22"), accountB, "AED", 100n),
        ]),
      ),
    ).toThrow("require valuations");
  });

  it("requires a common valuation currency and quote provenance", () => {
    const differentCurrency = [
      valuedPosting(postingId("23"), accountA, "USD", -100n, "AED", -367n),
      valuedPosting(postingId("24"), accountB, "EUR", 92n, "EUR", 92n),
    ];
    expect(() => createJournal(input(differentCurrency))).toThrow(
      "one currency and quote provenance",
    );

    const missingQuote = [
      valuedPosting(postingId("25"), accountA, "USD", -100n, "AED", -367n),
      valuedPosting(postingId("26"), accountB, "AED", 367n, "AED", 367n),
    ];
    missingQuote[1]!.valuation!.quoteIds = [];
    expect(() => createJournal(input(missingQuote))).toThrow(
      "one currency and quote provenance",
    );
  });

  it("rejects a non-zero valuation total", () => {
    expect(() =>
      createJournal(
        input([
          valuedPosting(postingId("27"), accountA, "USD", -100n, "AED", -367n),
          valuedPosting(postingId("28"), accountB, "AED", 366n, "AED", 366n),
        ]),
      ),
    ).toThrow("Unbalanced valuation AED: -1");
  });

  it("rejects duplicate posting IDs", () => {
    const duplicateId = postingId("29");
    expect(() =>
      createJournal(
        input([
          posting(duplicateId, accountA, "AED", -100n),
          posting(duplicateId, accountB, "AED", 100n),
        ]),
      ),
    ).toThrow("posting ID");
  });

  it.each(["", "  \t\n "])("rejects an empty description (%j)", (description) => {
    expect(() => createJournal({ ...input([]), description })).toThrow("description");
  });

  it("validates occurredOn through the shared ISO date contract", () => {
    expect(() =>
      createJournal({
        ...input([
          posting(postingId("30"), accountA, "AED", -1n),
          posting(postingId("31"), accountB, "AED", 1n),
        ]),
        occurredOn: "04/08/2026",
      }),
    ).toThrow("occurredOn");
  });
});

describe("journal immutability", () => {
  it("deeply clones and freezes the journal without mutating or aliasing inputs", () => {
    const quoteIds = [quoteId];
    const first = valuedPosting(
      postingId("32"),
      accountA,
      "USD",
      -100n,
      "AED",
      -367n,
    );
    first.valuation!.quoteIds = quoteIds;
    const second = valuedPosting(
      postingId("33"),
      accountB,
      "AED",
      367n,
      "AED",
      367n,
    );
    const postings = [first, second];
    const createInput = input(postings);
    const snapshot = structuredClone(createInput);

    const entry = createJournal(createInput);

    expect(createInput).toEqual(snapshot);
    first.amount.minor = -999n;
    first.valuation!.minor = -999n;
    quoteIds.push("00000000-0000-4000-8000-000000000100");
    postings.push(posting(postingId("34"), accountC, "AED", 0n));

    expect(entry.postings[0]?.amount.minor).toBe(-100n);
    expect(entry.postings[0]?.valuation?.minor).toBe(-367n);
    expect(entry.postings[0]?.valuation?.quoteIds).toEqual([quoteId]);
    expect(entry.postings).toHaveLength(2);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.postings)).toBe(true);
    expect(Object.isFrozen(entry.postings[0])).toBe(true);
    expect(Object.isFrozen(entry.postings[0]?.amount)).toBe(true);
    expect(Object.isFrozen(entry.postings[0]?.valuation)).toBe(true);
    expect(Object.isFrozen(entry.postings[0]?.valuation?.quoteIds)).toBe(true);
  });

  it("replaceJournal preserves identity and metadata, increments version, and revalidates", () => {
    const original = createJournal(
      input([
        posting(postingId("35"), accountA, "AED", -100n),
        posting(postingId("36"), accountB, "AED", 100n),
      ]),
    );
    const replacements = [
      posting(postingId("37"), accountA, "AED", -250n),
      posting(postingId("38"), accountB, "AED", 250n),
    ];

    const next = replaceJournal(original, replacements);

    expect(next).toMatchObject({
      id: original.id,
      workspaceId: original.workspaceId,
      occurredOn: original.occurredOn,
      description: original.description,
      version: 1,
      deletedAt: original.deletedAt,
      transferLinkId: original.transferLinkId,
    });
    expect(original.version).toBe(0);
    expect(next.postings).toEqual(replacements);
    expect(next.postings).not.toBe(replacements);
    expect(next.postings[0]).not.toBe(replacements[0]);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.postings)).toBe(true);

    replacements[0]!.amount.minor = -249n;
    expect(next.postings[0]?.amount.minor).toBe(-250n);
    expect(() =>
      replaceJournal(original, [
        posting(postingId("39"), accountA, "AED", -250n),
        posting(postingId("40"), accountB, "AED", 249n),
      ]),
    ).toThrow("Unbalanced AED: -1");
  });
});
