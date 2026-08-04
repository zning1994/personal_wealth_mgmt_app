import {
  IsoDateSchema,
  type AccountId,
  type JournalEntryId,
  type PostingId,
  type PostingRole,
  type WorkspaceId,
} from "@pwm/contracts";

import type { Money, Valuation } from "./money";

export type { PostingRole } from "@pwm/contracts";

export interface Posting {
  readonly id: PostingId;
  readonly accountId: AccountId;
  readonly amount: Money;
  readonly valuation?: Valuation;
  readonly role: PostingRole;
}

export interface JournalEntry {
  readonly id: JournalEntryId;
  readonly workspaceId: WorkspaceId;
  readonly occurredOn: string;
  readonly description: string;
  readonly postings: readonly Posting[];
  readonly version: number;
  readonly deletedAt: string | null;
  readonly transferLinkId: string | null;
}

export interface CreateJournalInput {
  readonly id: JournalEntryId;
  readonly workspaceId: WorkspaceId;
  readonly occurredOn: string;
  readonly description: string;
  readonly postings: readonly Posting[];
}

function assertUniquePostingIds(postings: readonly Posting[]): void {
  const postingIds = new Set<PostingId>();
  for (const posting of postings) {
    if (postingIds.has(posting.id)) {
      throw new Error(`Duplicate posting ID: ${posting.id}`);
    }
    postingIds.add(posting.id);
  }
}

export function assertBalanced(postings: readonly Posting[]): void {
  if (postings.length < 2) {
    throw new Error("A journal requires at least two postings");
  }

  assertUniquePostingIds(postings);

  const currencies = new Set(postings.map((posting) => posting.amount.currency));
  const hasValuation = postings.some((posting) => posting.valuation !== undefined);

  if (currencies.size === 1 && !hasValuation) {
    const currency = postings[0]!.amount.currency;
    const total = postings.reduce(
      (sum, posting) => sum + posting.amount.minor,
      0n,
    );
    if (total !== 0n) {
      throw new Error(`Unbalanced ${currency}: ${total}`);
    }
    return;
  }

  if (postings.some((posting) => posting.valuation === undefined)) {
    throw new Error("Cross-currency postings require valuations");
  }

  const valuations = postings.map((posting) => posting.valuation as Valuation);
  const valuationCurrency = valuations[0]!.currency;
  if (
    valuations.some(
      (valuation) =>
        valuation.currency !== valuationCurrency || valuation.quoteIds.length === 0,
    )
  ) {
    throw new Error(
      "Cross-currency valuations require one currency and quote provenance",
    );
  }

  const total = valuations.reduce(
    (sum, valuation) => sum + valuation.minor,
    0n,
  );
  if (total !== 0n) {
    throw new Error(`Unbalanced valuation ${valuationCurrency}: ${total}`);
  }
}

function cloneMoney(money: Money): Money {
  return Object.freeze({
    currency: money.currency,
    minor: money.minor,
  });
}

function cloneValuation(valuation: Valuation): Valuation {
  return Object.freeze({
    currency: valuation.currency,
    minor: valuation.minor,
    quoteIds: Object.freeze([...valuation.quoteIds]),
    asOf: valuation.asOf,
  });
}

function clonePosting(posting: Posting): Posting {
  const valuation =
    posting.valuation === undefined
      ? undefined
      : cloneValuation(posting.valuation);

  return Object.freeze({
    id: posting.id,
    accountId: posting.accountId,
    amount: cloneMoney(posting.amount),
    ...(valuation === undefined ? {} : { valuation }),
    role: posting.role,
  });
}

function clonePostings(postings: readonly Posting[]): readonly Posting[] {
  return Object.freeze(postings.map(clonePosting));
}

export function createJournal(input: CreateJournalInput): JournalEntry {
  const description = input.description.trim();
  if (description.length === 0) {
    throw new Error("Journal description is required");
  }
  if (!IsoDateSchema.safeParse(input.occurredOn).success) {
    throw new Error("Journal occurredOn must be an ISO date");
  }

  assertBalanced(input.postings);

  return Object.freeze({
    id: input.id,
    workspaceId: input.workspaceId,
    occurredOn: input.occurredOn,
    description,
    postings: clonePostings(input.postings),
    version: 0,
    deletedAt: null,
    transferLinkId: null,
  });
}

export function replaceJournal(
  entry: JournalEntry,
  postings: readonly Posting[],
): JournalEntry {
  assertBalanced(postings);

  return Object.freeze({
    ...entry,
    postings: clonePostings(postings),
    version: entry.version + 1,
  });
}
