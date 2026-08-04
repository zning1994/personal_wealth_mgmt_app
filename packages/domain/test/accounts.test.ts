import { describe, expect, it } from "vitest";

import type { AccountId, Currency, ProfileId, WorkspaceId } from "@pwm/contracts";

import { createAccount, validateOwnership } from "../src/index";

const workspaceId = "00000000-0000-4000-8000-000000000001" as WorkspaceId;
const accountId = "00000000-0000-4000-8000-000000000002" as AccountId;
const otherAccountId = "00000000-0000-4000-8000-000000000003" as AccountId;
const profileId = "00000000-0000-4000-8000-000000000004" as ProfileId;
const otherProfileId = "00000000-0000-4000-8000-000000000005" as ProfileId;
const currency = "AED" as Currency;

function cashAccount() {
  return createAccount({
    id: accountId,
    workspaceId,
    name: "Cash",
    kind: "asset",
    currency,
  });
}

describe("createAccount", () => {
  it.each(["", "  \t\n  "])("rejects an empty account name (%j)", (name) => {
    expect(() =>
      createAccount({ id: accountId, workspaceId, name, kind: "asset", currency }),
    ).toThrow("name");
  });

  it("trims the name and supplies aggregate defaults", () => {
    const account = createAccount({
      id: accountId,
      workspaceId,
      name: "  Household Cash  ",
      kind: "asset",
      currency,
    });

    expect(account).toEqual({
      id: accountId,
      workspaceId,
      name: "Household Cash",
      kind: "asset",
      currency,
      version: 0,
      deletedAt: null,
    });
    expect(Object.isFrozen(account)).toBe(true);
  });

  it("does not mutate its input", () => {
    const input = {
      id: accountId,
      workspaceId,
      name: "  Cash  ",
      kind: "asset" as const,
      currency,
    };
    const snapshot = { ...input };

    createAccount(input);

    expect(input).toEqual(snapshot);
  });
});

describe("validateOwnership", () => {
  it("rejects an account with no owners", () => {
    expect(() => validateOwnership(cashAccount(), [])).toThrow("owner");
  });

  it("rejects ownership for a different account", () => {
    expect(() =>
      validateOwnership(cashAccount(), [
        { accountId: otherAccountId, profileId, basisPoints: 10_000 },
      ]),
    ).toThrow("account");
  });

  it.each([1.5, 0, -1, 10_001])("rejects invalid basis points %s", (basisPoints) => {
    expect(() =>
      validateOwnership(cashAccount(), [{ accountId, profileId, basisPoints }]),
    ).toThrow("basis points");
  });

  it("requires ownership percentages to total 10000 basis points", () => {
    expect(() =>
      validateOwnership(cashAccount(), [
        { accountId, profileId, basisPoints: 6_000 },
        { accountId, profileId: otherProfileId, basisPoints: 3_000 },
      ]),
    ).toThrow("10000");
  });

  it("rejects duplicate profile rows even when their sum is valid", () => {
    expect(() =>
      validateOwnership(cashAccount(), [
        { accountId, profileId, basisPoints: 6_000 },
        { accountId, profileId, basisPoints: 4_000 },
      ]),
    ).toThrow("duplicate");
  });

  it("accepts one or more distinct owners totaling 10000 basis points", () => {
    expect(() =>
      validateOwnership(cashAccount(), [{ accountId, profileId, basisPoints: 10_000 }]),
    ).not.toThrow();
    expect(() =>
      validateOwnership(cashAccount(), [
        { accountId, profileId, basisPoints: 6_000 },
        { accountId, profileId: otherProfileId, basisPoints: 4_000 },
      ]),
    ).not.toThrow();
  });

  it("does not mutate the ownership input", () => {
    const ownerships = Object.freeze([
      Object.freeze({ accountId, profileId, basisPoints: 10_000 }),
    ]);

    validateOwnership(cashAccount(), ownerships);

    expect(ownerships).toEqual([{ accountId, profileId, basisPoints: 10_000 }]);
  });
});
