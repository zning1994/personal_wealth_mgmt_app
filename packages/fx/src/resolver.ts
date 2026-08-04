import type { Currency } from "@pwm/contracts";
import type { RationalRate } from "./boc/normalize";
import type { ManualOverrideStore, QuoteCache } from "./ports";

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
