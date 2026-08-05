import type { Currency, WorkspaceId } from "@pwm/contracts";
import type { Money } from "@pwm/domain";
import type { RationalRate } from "./boc/normalize";
import type { ManualOverrideStore, QuoteCache } from "./ports";

/** Lookup key used by application valuation queries. */
export interface FxLookup {
  readonly workspaceId: WorkspaceId;
  readonly from: Currency;
  readonly to: Currency;
  readonly onDate: string;
}

export interface CachedRate {
  readonly rate: RationalRate;
  readonly provider: "boc";
  readonly field: "spot_buy" | "cash_buy" | "spot_sell" | "cash_sell" | "conversion";
  /** Original provider fields retained for reproducible disclosure. */
  readonly cnyPer100?: string;
  readonly publishedAtUtc?: string;
  readonly fetchedAt: string;
  readonly etag: string | null;
  readonly payloadHash: string;
}

export interface ManualRateOverride {
  readonly id: string;
  readonly workspaceId: string;
  readonly rate: RationalRate;
  readonly deletedAt: string | null;
}

/** Persistence boundary for deterministic manual > cache FX resolution. */
export interface FxRateStore {
  findManual(input: FxLookup): Promise<ManualRateOverride | null>;
  findCached(input: FxLookup): Promise<CachedRate | null>;
  putCached(rate: CachedRate): Promise<void>;
}

export type FxResolution =
  | {
      readonly status: "fresh" | "stale";
      readonly source: "manual" | "cache";
      readonly rate: RationalRate;
      readonly ageDays: number;
    }
  | {
      readonly status: "missing";
      readonly source: "none";
      readonly original: Money;
    };

export class FxResolver {
  constructor(private readonly store: FxRateStore) {}

  async resolve(input: FxLookup & {
    readonly amount: Money;
    readonly offline: boolean;
    readonly staleAfterDays: number;
    readonly now: string;
  }): Promise<FxResolution> {
    const manual = await this.store.findManual(input);
    if (manual !== null && manual.deletedAt === null) {
      return {
        status: "fresh",
        source: "manual",
        rate: manual.rate,
        ageDays: 0,
      };
    }

    // The provider/cache decision is intentionally delegated to the caller's
    // fetch pipeline.  Offline mode must never suppress a usable cache row.
    void input.offline;
    const cached = await this.store.findCached(input);
    if (cached === null) {
      return { status: "missing", source: "none", original: input.amount };
    }
    const asOfMs = Date.parse(`${cached.rate.asOf}T00:00:00Z`);
    const nowMs = Date.parse(input.now);
    const ageDays = Number.isFinite(asOfMs) && Number.isFinite(nowMs)
      ? Math.max(0, Math.floor((nowMs - asOfMs) / 86_400_000))
      : input.staleAfterDays + 1;
    return {
      status: ageDays > input.staleAfterDays ? "stale" : "fresh",
      source: "cache",
      rate: cached.rate,
      ageDays,
    };
  }
}

export type ResolvedRate = { status: "fresh" | "stale" | "missing"; provider: "manual" | "boc" | null; rate: RationalRate | null; asOf: string | null };
export async function resolveRate(input: { from: Currency; to: Currency; asOf: string; override: ManualOverrideStore; cache: QuoteCache; provider?: () => Promise<RationalRate | null>; now?: string }): Promise<ResolvedRate> {
  const manual = await input.override.get(input.from, input.to, input.asOf);
  if (manual) return { status: "fresh", provider: "manual", rate: { from: input.from, to: input.to, ...manual, quoteIds: [], asOf: input.asOf }, asOf: input.asOf };
  if (input.provider) { const fresh = await input.provider(); if (fresh) return { status: "fresh", provider: "boc", rate: fresh, asOf: fresh.asOf }; }
  const cached = await input.cache.get(`${input.from}:${input.to}:${input.asOf}`);
  if (!cached) return { status: "missing", provider: null, rate: null, asOf: null };
  const staleRate = cached.body as RationalRate;
  return { status: "stale", provider: "boc", rate: staleRate, asOf: staleRate.asOf ?? input.asOf };
}
