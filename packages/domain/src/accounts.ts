import type { AccountId, Currency, ProfileId, WorkspaceId } from "@pwm/contracts";

export type AccountKind = "asset" | "liability" | "income" | "expense" | "equity";

export interface Profile {
  readonly id: ProfileId;
  readonly workspaceId: WorkspaceId;
  readonly displayName: string;
  readonly version: number;
  readonly deletedAt: string | null;
}

export interface Account {
  readonly id: AccountId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly kind: AccountKind;
  readonly currency: Currency;
  readonly version: number;
  readonly deletedAt: string | null;
}

export interface AccountOwnership {
  readonly accountId: AccountId;
  readonly profileId: ProfileId;
  readonly basisPoints: number;
}

export interface CreateAccountInput {
  readonly id: AccountId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly kind: AccountKind;
  readonly currency: Currency;
}

export function createAccount(input: CreateAccountInput): Account {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error("Account name is required");
  }

  return Object.freeze({
    id: input.id,
    workspaceId: input.workspaceId,
    name,
    kind: input.kind,
    currency: input.currency,
    version: 0,
    deletedAt: null,
  });
}

export function validateOwnership(
  account: Account,
  ownerships: readonly AccountOwnership[],
): void {
  if (ownerships.length === 0) {
    throw new Error("At least one owner is required");
  }

  const seenProfileIds = new Set<ProfileId>();
  let total = 0;

  for (const ownership of ownerships) {
    if (ownership.accountId !== account.id) {
      throw new Error("Ownership row must reference the account");
    }
    if (
      !Number.isInteger(ownership.basisPoints) ||
      ownership.basisPoints <= 0 ||
      ownership.basisPoints > 10_000
    ) {
      throw new Error("Ownership basis points must be an integer from 1 to 10000");
    }
    if (seenProfileIds.has(ownership.profileId)) {
      throw new Error("Ownership cannot contain a duplicate profile");
    }

    seenProfileIds.add(ownership.profileId);
    total += ownership.basisPoints;
  }

  if (total !== 10_000) {
    throw new Error(`Ownership must total 10000 basis points; received ${total}`);
  }
}
