import { describe, expect, it } from "vitest";
import { convertMinor, crossViaCny, normalizeBocRate } from "../src";
import type { Currency } from "@pwm/contracts";

const wire = (code: string, conversion: number) => ({ code, name_zh: code, as_of_date: "20260425", spot_buy: null, cash_buy: null, spot_sell: null, cash_sell: null, conversion, published_at_utc: "2026-04-24T17:48:00Z", published_at: "2026-04-25T01:48:00+08:00" });
describe("exact BOC arithmetic", () => {
  it("uses the per-100 foreign-unit convention", () => {
    const rate = normalizeBocRate({ quoteId: "usd", rate: wire("USD", 686.74), field: "conversion", foreignMinorDigits: 2 });
    expect(convertMinor({ currency: "USD" as Currency, minor: 10000n }, rate)).toEqual({ currency: "CNY", minor: 68674n });
  });
  it("keeps both quote IDs for a cross rate", () => {
    const usd = normalizeBocRate({ quoteId: "usd", rate: wire("USD", 686.74), field: "conversion", foreignMinorDigits: 2 });
    const aed = normalizeBocRate({ quoteId: "aed", rate: wire("AED", 187.02), field: "conversion", foreignMinorDigits: 2 });
    const cross = crossViaCny(usd, aed);
    expect(cross.quoteIds).toEqual(["usd", "aed"]);
    expect(convertMinor({ currency: "USD" as Currency, minor: 10000n }, cross).minor).toBe(36720n);
  });
});
