import type { Currency } from "@pwm/contracts";
import { BocCurrenciesResponseSchema, BocHistoricalResponseSchema, BocLatestAllResponseSchema, BocLatestOneResponseSchema } from "./schemas";
import type { HttpTransport } from "../ports";

const BASE = "https://api-bocurrencyprice.techina.science";
export type BocResult = { kind: "not-modified"; etag: string | null; requestKey: string } | { kind: "data"; etag: string | null; requestKey: string; body: unknown; rawBody: string; fetchedAt: string };
const parseDate = (value: string) => new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
const compact = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");
export function splitInclusiveDateRange(from: string, to: string, maxDays = 365): readonly { from: string; to: string }[] {
  const start = parseDate(from); const end = parseDate(to);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || start > end || maxDays < 1 || maxDays > 365) throw new Error("INVALID_HISTORICAL_RANGE");
  const result: { from: string; to: string }[] = []; let cursor = start;
  while (cursor <= end) { const chunkEnd = new Date(Math.min(end.valueOf(), cursor.valueOf() + (maxDays - 1) * 86_400_000)); result.push({ from: compact(cursor), to: compact(chunkEnd) }); cursor = new Date(chunkEnd.valueOf() + 86_400_000); }
  return result;
}
export class BocClient {
  constructor(private readonly http: HttpTransport, private readonly now: () => string = () => new Date().toISOString(), private readonly baseUrl = BASE) {}
  private async request(requestKey: string, url: string, etag: string | undefined, schema: { parse(value: unknown): unknown }): Promise<BocResult> {
    const headers = etag ? { "If-None-Match": etag } : {};
    const response = await this.http.request({ url, headers });
    const responseEtag = response.headers.etag ?? null;
    if (response.status === 304) return { kind: "not-modified", etag: responseEtag ?? etag ?? null, requestKey };
    if (response.status < 200 || response.status >= 300) throw new Error(`BOC_HTTP_${response.status}`);
    let body: unknown; try { body = JSON.parse(response.body); } catch { throw new Error("BOC_INVALID_JSON"); }
    return { kind: "data", etag: responseEtag, requestKey, body: schema.parse(body), rawBody: response.body, fetchedAt: this.now() };
  }
  listCurrencies(etag?: string) { return this.request("currencies", `${this.baseUrl}/v1/currencies`, etag, BocCurrenciesResponseSchema); }
  latestAll(tz: string, etag?: string) { return this.request(`latest-all:${tz}`, `${this.baseUrl}/v1/latest?tz=${encodeURIComponent(tz)}`, etag, BocLatestAllResponseSchema); }
  latestOne(ccy: Currency, tz: string, etag?: string) { return this.request(`latest-one:${ccy}:${tz}`, `${this.baseUrl}/v1/latest/${ccy}?tz=${encodeURIComponent(tz)}`, etag, BocLatestOneResponseSchema); }
  async historical(ccy: Currency, from: string, to: string, tz: string, etags: ReadonlyMap<string, string> = new Map()) {
    const results: BocResult[] = [];
    for (const range of splitInclusiveDateRange(from, to)) { const key = `historical:${ccy}:${range.from}:${range.to}:${tz}`; results.push(await this.request(key, `${this.baseUrl}/v1/historical/${ccy}?from=${range.from}&to=${range.to}&tz=${encodeURIComponent(tz)}`, etags.get(key), BocHistoricalResponseSchema)); }
    return results;
  }
}
