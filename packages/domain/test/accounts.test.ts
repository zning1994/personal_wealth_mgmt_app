import { describe, expect, it } from "vitest";

import type { AccountId, Currency, ProfileId, WorkspaceId } from "@pwm/contracts";

import type { Profile } from "../src/index";
import { createAccount, validateOwnership } from "../src/index";

const workspaceId = "00000000-0000-4000-8000-000000000001" as WorkspaceId;
const otherWorkspaceId = "00000000-0000-4000-8000-000000000006" as WorkspaceId;
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

function activeProfile(
  id: ProfileId = profileId,
  profileWorkspaceId: WorkspaceId = workspaceId,
): Profile {
  return Object.freeze({
    id,
    workspaceId: profileWorkspaceId,
    displayName: id === profileId ? "Primary" : "Shared owner",
    version: 0,
    deletedAt: null,
  });
}

function activeProfiles(): readonly Profile[] {
  return [activeProfile(), activeProfile(otherProfileId)];
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
    expect(() => validateOwnership(cashAccount(), [], activeProfiles())).toThrow("owner");
  });

  it("rejects ownership for a different account", () => {
    expect(() =>
      validateOwnership(
        cashAccount(),
        [{ workspaceId, accountId: otherAccountId, profileId, basisPoints: 10_000 }],
        activeProfiles(),
      ),
    ).toThrow("account");
  });

  it("rejects an ownership row from another workspace", () => {
    expect(() =>
      validateOwnership(
        cashAccount(),
        [{ workspaceId: otherWorkspaceId, accountId, profileId, basisPoints: 10_000 }],
        activeProfiles(),
      ),
    ).toThrow("workspace");
  });

  it("rejects an ownership row whose profile is missing", () => {
    expect(() =>
      validateOwnership(
        cashAccount(),
        [{ workspaceId, accountId, profileId, basisPoints: 10_000 }],
        [],
      ),
    ).toThrow("profile");
  });

  it("rejects an ownership profile from another workspace", () => {
    expect(() =>
      validateOwnership(
        cashAccount(),
        [{ workspaceId, accountId, profileId, basisPoints: 10_000 }],
        [activeProfile(profileId, otherWorkspaceId)],
      ),
    ).toThrow("workspace");
  });

  it("rejects ownership by a deleted profile", () => {
    const deletedProfile: Profile = Object.freeze({
      ...activeProfile(),
      deletedAt: "2026-08-04T10:00:00.000Z",
    });

    expect(() =>
      validateOwnership(
        cashAccount(),
        [{ workspaceId, accountId, profileId, basisPoints: 10_000 }],
        [deletedProfile],
      ),
    ).toThrow("deleted");
  });

  it("rejects duplicate profile definitions", () => {
    expect(() =>
      validateOwnership(
        cashAccount(),
        [{ workspaceId, accountId, profileId, basisPoints: 10_000 }],
        [activeProfile(), activeProfile()],
      ),
    ).toThrow("duplicate");
  });

  it.each([1.5, 0, -1, 10_001])("rejects invalid basis points %s", (basisPoints) => {
    expect(() =>
      validateOwnership(
        cashAccount(),
        [{ workspaceId, accountId, profileId, basisPoints }],
        activeProfiles(),
      ),
    ).toThrow("basis points");
  });

  it("requires ownership percentages to total 10000 basis points", () => {
    expect(() =>
      validateOwnership(
        cashAccount(),
        [
          { workspaceId, accountId, profileId, basisPoints: 6_000 },
          { workspaceId, accountId, profileId: otherProfileId, basisPoints: 3_000 },
        ],
        activeProfiles(),
      ),
    ).toThrow("10000");
  });

  it("rejects duplicate profile rows even when their sum is valid", () => {
    expect(() =>
      validateOwnership(
        cashAccount(),
        [
          { workspaceId, accountId, profileId, basisPoints: 6_000 },
          { workspaceId, accountId, profileId, basisPoints: 4_000 },
        ],
        activeProfiles(),
      ),
    ).toThrow("duplicate");
  });

  it("accepts one or more distinct owners totaling 10000 basis points", () => {
    expect(() =>
      validateOwnership(
        cashAccount(),
        [{ workspaceId, accountId, profileId, basisPoints: 10_000 }],
        activeProfiles(),
      ),
    ).not.toThrow();
    expect(() =>
      validateOwnership(
        cashAccount(),
        [
          { workspaceId, accountId, profileId, basisPoints: 6_000 },
          { workspaceId, accountId, profileId: otherProfileId, basisPoints: 4_000 },
        ],
        activeProfiles(),
      ),
    ).not.toThrow();
  });

  it("does not mutate ownership or profile inputs", () => {
    const ownerships = Object.freeze([
      Object.freeze({ workspaceId, accountId, profileId, basisPoints: 10_000 }),
    ]);
    const profiles = Object.freeze([activeProfile()]);

    validateOwnership(cashAccount(), ownerships, profiles);

    expect(ownerships).toEqual([{ workspaceId, accountId, profileId, basisPoints: 10_000 }]);
    expect(profiles).toEqual([activeProfile()]);
  });
});
