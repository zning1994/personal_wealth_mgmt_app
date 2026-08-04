import { describe, expect, it } from "vitest";
import {
  AccountIdSchema,
  ActivityOperationIdSchema,
  CommodityDtoSchema,
  EntityMetaSchema,
  ImportBatchIdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  JournalEntryIdSchema,
  MoneyDtoSchema,
  PostingIdSchema,
  ProfileIdSchema,
  RawRecordIdSchema,
  ValuationDtoSchema,
  parseMoneyDto,
} from "../src/index";

const UUID = "018f4f7e-8ead-7c0d-8000-000000000001";

describe("ledger identifier contracts", () => {
  it("accepts UUIDs for every stable ledger identifier", () => {
    const schemas = [
      ProfileIdSchema,
      AccountIdSchema,
      JournalEntryIdSchema,
      PostingIdSchema,
      ImportBatchIdSchema,
      RawRecordIdSchema,
      ActivityOperationIdSchema,
    ];

    for (const schema of schemas) {
      expect(schema.parse(UUID)).toBe(UUID);
      expect(() => schema.parse("not-a-uuid")).toThrow();
    }
  });
});

describe("ISO date contracts", () => {
  it("accepts calendar-shaped dates and offset-aware date-times", () => {
    expect(IsoDateSchema.parse("2026-08-04")).toBe("2026-08-04");
    expect(IsoDateTimeSchema.parse("2026-08-04T12:30:00+04:00")).toBe(
      "2026-08-04T12:30:00+04:00",
    );
    expect(() => IsoDateSchema.parse("2026/08/04")).toThrow();
    expect(() => IsoDateTimeSchema.parse("2026-08-04T12:30:00")).toThrow();
  });

  it("validates strict serializable entity metadata", () => {
    const input = {
      workspaceId: UUID,
      createdAt: "2026-08-04T12:30:00+04:00",
      updatedAt: "2026-08-04T12:31:00+04:00",
      version: 0,
      deletedAt: null,
    };

    expect(EntityMetaSchema.parse(input)).toEqual(input);
    expect(() =>
      EntityMetaSchema.parse({ ...input, unexpected: true }),
    ).toThrow();
  });
});

describe("MoneyDto", () => {
  it("accepts integer minor units and normalizes currencies", () => {
    const money = parseMoneyDto({ currency: "aed", minor: "-1250" });

    expect(money).toEqual({
      currency: "AED",
      minor: "-1250",
    });
    expect(Object.isFrozen(money)).toBe(true);
    expect(MoneyDtoSchema.parse({ currency: "uSd", minor: "0" })).toEqual({
      currency: "USD",
      minor: "0",
    });
  });

  it.each(["12.50", "1e3", "01", "-01", "-0", "+1", "", " 1"])(
    "rejects non-canonical minor-unit string %j",
    (minor) => {
      expect(() => parseMoneyDto({ currency: "AED", minor })).toThrow();
    },
  );

  it("rejects unknown fields and non-three-letter currencies", () => {
    expect(() =>
      parseMoneyDto({ currency: "AED", minor: "1", floating: 1 }),
    ).toThrow();
    expect(() => parseMoneyDto({ currency: "USDT", minor: "1" })).toThrow();
  });
});

describe("commodity and valuation DTOs", () => {
  it("accepts bounded commodity scale and rejects unknown fields", () => {
    const commodity = CommodityDtoSchema.parse({ code: "BTC", scale: 8 });

    expect(commodity).toEqual({
      code: "BTC",
      scale: 8,
    });
    expect(Object.isFrozen(commodity)).toBe(true);
    expect(() =>
      CommodityDtoSchema.parse({ code: "BTC", scale: 19 }),
    ).toThrow();
    expect(() =>
      CommodityDtoSchema.parse({ code: "BTC", scale: 8, symbol: "BTC" }),
    ).toThrow();
  });

  it("normalizes and freezes valuations and their quote IDs", () => {
    const quoteId = "018f4f7e-8ead-7c0d-8000-000000000002";
    const valuation = ValuationDtoSchema.parse({
      currency: "usd",
      minor: "125000",
      quoteIds: [quoteId],
      asOf: "2026-08-04",
    });

    expect(valuation).toEqual({
      currency: "USD",
      minor: "125000",
      quoteIds: [quoteId],
      asOf: "2026-08-04",
    });
    expect(Object.isFrozen(valuation)).toBe(true);
    expect(Object.isFrozen(valuation.quoteIds)).toBe(true);
    expect(() =>
      ValuationDtoSchema.parse({
        currency: "USD",
        minor: "125000",
        quoteIds: ["not-a-uuid"],
        asOf: "2026-08-04",
        source: "remote",
      }),
    ).toThrow();
  });
});
