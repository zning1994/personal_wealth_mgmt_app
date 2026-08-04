import { describe, expect, it } from "vitest";
import { asCategoryAccount, detectDuplicate, matchCategoryRule, scoreInternalTransferPair } from "../src";

const account = { id: "00000000-0000-4000-8000-000000000200" as never, workspaceId: "00000000-0000-4000-8000-000000000001" as never, name: "Food", kind: "expense" as const, currency: "AED" as never, version: 0, deletedAt: null };

describe("category, dedupe and transfer matching", () => {
  it("allows only income and expense category accounts", () => {
    expect(asCategoryAccount(account).kind).toBe("expense");
    expect(() => asCategoryAccount({ ...account, kind: "asset" })).toThrow("income or expense");
  });

  it("ranks category rules deterministically", () => {
    const common = { workspaceId: account.workspaceId, categoryAccountId: account.id, priority: 10, matcher: { descriptionIncludes: "market" } };
    expect(matchCategoryRule({ accountId: "00000000-0000-4000-8000-000000000201" as never, description: "Night Market", amount: { currency: "AED" as never, minor: -500n } }, [{ ...common, id: "b" }, { ...common, id: "a" } ])?.id).toBe("a");
  });

  it("preserves source-first dedupe tiers", () => {
    const left = { accountId: "a", sourceHash: "sha256:x", sourceLocator: "row:1", stableReference: "bank-7", date: "2026-08-01", minor: -500n, currency: "AED", normalizedDescription: "shop", balanceMinor: 1000n };
    expect(detectDuplicate(left, { ...left, normalizedDescription: "changed" })).toBe("exact-source");
    expect(detectDuplicate(left, { ...left, sourceHash: "sha256:y", sourceLocator: "row:9" })).toBe("stable-reference");
    expect(detectDuplicate({ ...left, stableReference: null }, { ...left, sourceHash: "sha256:y", sourceLocator: "row:9", stableReference: null })).toBe("fingerprint");
  });

  it("scores an internal transfer without auto-linking it", () => {
    const left = { accountId: "a", date: "2026-08-01", currency: "AED", minor: -10000n, description: "transfer ref7", reference: "ref7", principalValuation: null, feeMinor: 0n };
    expect(scoreInternalTransferPair(left, { ...left, accountId: "b", minor: 10000n })).toMatchObject({ score: 95 });
  });
});
