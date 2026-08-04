import fc from "fast-check";
import { expect, it } from "vitest";

import type {
  AccountId,
  Currency,
  JournalEntryId,
  PostingId,
  WorkspaceId,
} from "@pwm/contracts";

import { createJournal } from "../src/index";

type PropertyInput = {
  id: JournalEntryId;
  workspaceId: WorkspaceId;
  occurredOn: string;
  description: string;
  postings: Array<{
    id: PostingId;
    accountId: AccountId;
    amount: { currency: Currency; minor: bigint };
    role: "principal";
  }>;
};
const id = (value: string) => value as never;
const base = {
  id: id("00000000-0000-4000-8000-000000000030"),
  workspaceId: id("00000000-0000-4000-8000-000000000001"),
  occurredOn: "2026-08-04",
  description: "generated",
};

function postings(left: bigint, right: bigint): PropertyInput["postings"] {
  return [
    {
      id: id("00000000-0000-4000-8000-000000000031"),
      accountId: id("00000000-0000-4000-8000-000000000041"),
      amount: { currency: id("AED"), minor: left },
      role: "principal",
    },
    {
      id: id("00000000-0000-4000-8000-000000000032"),
      accountId: id("00000000-0000-4000-8000-000000000042"),
      amount: { currency: id("AED"), minor: right },
      role: "principal",
    },
  ];
}

const largeMinorUnits = fc.bigInt({
  min: -(10n ** 40n),
  max: 10n ** 40n,
});

it("accepts every generated balanced bigint journal without precision loss", () => {
  fc.assert(
    fc.property(largeMinorUnits, (minor) => {
      const journal = createJournal({ ...base, postings: postings(minor, -minor) });

      expect(journal.postings[0]!.amount.minor).toBe(minor);
      expect(journal.postings[1]!.amount.minor).toBe(-minor);
      expect(
        journal.postings[0]!.amount.minor + journal.postings[1]!.amount.minor,
      ).toBe(0n);
    }),
    { numRuns: 300 },
  );
});

it("rejects every generated journal after a one-minor-unit perturbation", () => {
  fc.assert(
    fc.property(largeMinorUnits, (minor) => {
      expect(() =>
        createJournal({ ...base, postings: postings(minor, -minor + 1n) }),
      ).toThrow("Unbalanced AED: 1");
    }),
    { numRuns: 300 },
  );
});
