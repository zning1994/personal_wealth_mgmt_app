import { describe, expect, it } from "vitest";
import { FxResolver, type FxRateStore } from "../src";
import type { Currency, WorkspaceId } from "@pwm/contracts";

const workspace = "00000000-0000-4000-8000-000000000001" as WorkspaceId;
const baseRate = {
  from: "USD" as Currency,
  to: "AED" as Currency,
  numerator: 367n,
  denominator: 100n,
  quoteIds: ["00000000-0000-4000-8000-000000000010"],
  asOf: "2026-08-01",
};
const input = {
  workspaceId: workspace,
  from: "USD" as Currency,
  to: "AED" as Currency,
  onDate: "2026-08-01",
  amount: { currency: "USD" as Currency, minor: 100n },
  offline: true,
  staleAfterDays: 2,
  now: "2026-08-04T00:00:00Z",
};

function store(overrides: Partial<FxRateStore> = {}): FxRateStore {
  return {
    findManual: async () => null,
    findCached: async () => null,
    putCached: async () => undefined,
    ...overrides,
  };
}

describe("FxResolver", () => {
  it("uses a live manual override before cache", async () => {
    const result = await new FxResolver(store({
      findManual: async () => ({ id: "manual", workspaceId: workspace, rate: baseRate, deletedAt: null }),
      findCached: async () => ({ provider: "boc", field: "conversion", fetchedAt: input.now, etag: null, payloadHash: "sha256:cached", rate: { ...baseRate, numerator: 1n } }),
    })).resolve(input);
    expect(result).toMatchObject({ status: "fresh", source: "manual", ageDays: 0 });
  });

  it("returns stale cache and preserves original amount when missing", async () => {
    const stale = await new FxResolver(store({
      findCached: async () => ({ provider: "boc", field: "conversion", fetchedAt: input.now, etag: null, payloadHash: "sha256:cached", rate: baseRate }),
    })).resolve(input);
    expect(stale).toMatchObject({ status: "stale", source: "cache", ageDays: 3 });
    const missing = await new FxResolver(store()).resolve(input);
    expect(missing).toMatchObject({ status: "missing", source: "none", original: input.amount });
  });
});
