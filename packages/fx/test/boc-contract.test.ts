import { describe, expect, it } from "vitest";
import { BocCurrenciesResponseSchema, BocHistoricalResponseSchema, BocLatestOneResponseSchema } from "../src";

const rate = { code: "USD", name_zh: "美元", as_of_date: "20260425", spot_buy: 682.06, cash_buy: 682.06, spot_sell: 684.93, cash_sell: 684.93, conversion: 686.74, published_at_utc: "2026-04-24T17:48:00Z", published_at: "2026-04-25T01:48:00+08:00" };
describe("BOC wire contracts", () => {
  it("accepts currencies, latest and historical response shapes", () => {
    expect(BocCurrenciesResponseSchema.parse({ data: [{ code: "USD", name_zh: "美元" }], meta: { count: 1 } }).meta.count).toBe(1);
    expect(BocLatestOneResponseSchema.parse({ data: rate, meta: { tz: "Asia/Shanghai" } }).data.conversion).toBe(686.74);
    expect(BocHistoricalResponseSchema.parse({ data: [rate], meta: { code: "USD", from: "20260425", to: "20260425", tz: "UTC", count: 1 } }).meta.to).toBe("20260425");
  });
  it("rejects a rate without canonical UTC publication time", () => {
    const invalid = { ...rate, published_at_utc: undefined };
    expect(() => BocLatestOneResponseSchema.parse({ data: invalid, meta: { tz: "UTC" } })).toThrow();
  });
});
