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
    expect(parseMoneyDto({ currency: "aed", minor: "-1250" })).toEqual({
      currency: "AED",
      minor: "-1250",
    });
    expect(MoneyDtoSchema.parse({ currency: "uSd", minor: "0" })).toEqual({
      currency: "USD",
      minor: "0",
    });
  });

  it.each(["12.50", "1e3", "01", "-01", "+1", "", " 1"])(
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
    expect(CommodityDtoSchema.parse({ code: "BTC", scale: 8 })).toEqual({
      code: "BTC",
      scale: 8,
    });
    expect(() =>
      CommodityDtoSchema.parse({ code: "BTC", scale: 19 }),
    ).toThrow();
    expect(() =>
      CommodityDtoSchema.parse({ code: "BTC", scale: 8, symbol: "BTC" }),
    ).toThrow();
  });

  it("normalizes valuations and keeps quote IDs immutable at the type boundary", () => {
    const quoteId = "018f4f7e-8ead-7c0d-8000-000000000002";
    expect(
      ValuationDtoSchema.parse({
        currency: "usd",
        minor: "125000",
        quoteIds: [quoteId],
        asOf: "2026-08-04",
      }),
    ).toEqual({
      currency: "USD",
      minor: "125000",
      quoteIds: [quoteId],
      asOf: "2026-08-04",
    });
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
