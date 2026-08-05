import { describe, expect, it } from "vitest";
import { BocClient, splitInclusiveDateRange, type HttpRequest, type HttpResponse, type HttpTransport } from "../src";
import type { Currency } from "@pwm/contracts";

class FakeHttp implements HttpTransport { requests: HttpRequest[] = []; constructor(private readonly responses: HttpResponse[]) {} async request(input: HttpRequest) { this.requests.push(input); return this.responses.shift() as HttpResponse; } }
const rate = { code: "USD", name_zh: "美元", as_of_date: "20260425", spot_buy: 682.06, cash_buy: 682.06, spot_sell: 684.93, cash_sell: 684.93, conversion: 686.74, published_at_utc: "2026-04-24T17:48:00Z", published_at: "2026-04-25T01:48:00+08:00" };
describe("BocClient", () => {
  it("splits inclusive ranges without gaps", () => expect(splitInclusiveDateRange("20260101", "20270101")).toEqual([{ from: "20260101", to: "20261231" }, { from: "20270101", to: "20270101" }]));
  it("preserves a 304 and sends If-None-Match", async () => {
    const http = new FakeHttp([{ status: 304, headers: { etag: "v1" }, body: "" }]);
    const result = await new BocClient(http, () => "2026-08-04T00:00:00.000Z").latestOne("USD" as Currency, "UTC", "v1");
    expect(http.requests[0]).toEqual({ url: "https://api-bocurrencyprice.techina.science/v1/latest/USD?tz=UTC", headers: { "If-None-Match": "v1" } });
    expect(result.kind).toBe("not-modified");
  });
  it("uses exact latest and historical endpoint paths", async () => {
    const http = new FakeHttp([{ status: 200, headers: {}, body: JSON.stringify({ data: [rate], meta: { tz: "UTC", count: 1 } }) }, { status: 200, headers: {}, body: JSON.stringify({ data: [rate], meta: { code: "USD", from: "20260101", to: "20260101", tz: "UTC", count: 1 } }) }]);
    const client = new BocClient(http, () => "2026-08-04T00:00:00.000Z");
    await client.latestAll("UTC"); await client.historical("USD" as Currency, "20260101", "20260101", "UTC");
    expect(http.requests.map((row) => row.url)).toEqual(["https://api-bocurrencyprice.techina.science/v1/latest?tz=UTC", "https://api-bocurrencyprice.techina.science/v1/historical/USD?from=20260101&to=20260101&tz=UTC"]);
  });
});
