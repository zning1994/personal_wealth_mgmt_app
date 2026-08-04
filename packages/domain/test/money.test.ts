import { describe, expect, it } from "vitest";

import type {
  Currency,
  MinorUnitString,
  MoneyDto,
  ValuationDto,
} from "@pwm/contracts";
import {
  addCommodity,
  addMoney,
  moneyFromDto,
  moneyToDto,
  sumMoney,
  valuationFromDto,
} from "../src/index";

const currency = (value: string): Currency => value as Currency;
const minor = (value: string): MinorUnitString => value as MinorUnitString;

describe("Money", () => {
  it.each([
    ["900719925474099300", 900719925474099300n],
    ["-900719925474099301", -900719925474099301n],
    ["0", 0n],
  ] as const)("round-trips canonical minor units %s exactly", (serialized, value) => {
    const dto: MoneyDto = Object.freeze({
      currency: currency("AED"),
      minor: minor(serialized),
    });

    const money = moneyFromDto(dto);
    const roundTrip = moneyToDto(money);

    expect(money).toEqual({ currency: "AED", minor: value });
    expect(Object.isFrozen(money)).toBe(true);
    expect(roundTrip).toEqual(dto);
    expect(Object.isFrozen(roundTrip)).toBe(true);
  });

  it("adds matching currencies without mutating its inputs", () => {
    const left = Object.freeze({ currency: currency("AED"), minor: 2n });
    const right = Object.freeze({ currency: currency("AED"), minor: -5n });

    const result = addMoney(left, right);

    expect(result).toEqual({ currency: "AED", minor: -3n });
    expect(Object.isFrozen(result)).toBe(true);
    expect(left.minor).toBe(2n);
    expect(right.minor).toBe(-5n);
  });

  it("refuses to add different currencies", () => {
    expect(() =>
      addMoney(
        { currency: currency("AED"), minor: 1n },
        { currency: currency("USD"), minor: 1n },
      ),
    ).toThrow("Currency mismatch");
  });

  it("sums an empty list to immutable zero in the requested currency", () => {
    const total = sumMoney(currency("AED"), []);

    expect(total).toEqual({ currency: "AED", minor: 0n });
    expect(Object.isFrozen(total)).toBe(true);
  });

  it("sums multiple values and rejects a mismatched currency", () => {
    expect(
      sumMoney(currency("AED"), [
        { currency: currency("AED"), minor: 10n },
        { currency: currency("AED"), minor: -4n },
        { currency: currency("AED"), minor: 7n },
      ]),
    ).toEqual({ currency: "AED", minor: 13n });

    expect(() =>
      sumMoney(currency("AED"), [
        { currency: currency("AED"), minor: 1n },
        { currency: currency("USD"), minor: 1n },
      ]),
    ).toThrow("Currency mismatch");
  });
});

describe("CommodityQuantity", () => {
  it("adds exact commodities and does not alias the input descriptor", () => {
    const commodity = { code: "XAU", scale: 6 };
    const left = { commodity, units: 1n };
    const right = { commodity: { code: "XAU", scale: 6 }, units: 2n };

    const result = addCommodity(left, right);
    commodity.code = "MUTATED";

    expect(result).toEqual({ commodity: { code: "XAU", scale: 6 }, units: 3n });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.commodity)).toBe(true);
  });

  it.each([
    { code: "XAG", scale: 6 },
    { code: "XAU", scale: 3 },
  ] as const)("rejects a commodity mismatch for %o", (rightCommodity) => {
    expect(() =>
      addCommodity(
        { commodity: { code: "XAU", scale: 6 }, units: 1n },
        { commodity: rightCommodity, units: 2n },
      ),
    ).toThrow("Commodity mismatch");
  });
});

describe("Valuation", () => {
  it("preserves exact value and provenance without aliasing quote IDs", () => {
    const quoteIds = ["018f4f7e-8ead-7c0d-8000-000000000099"];
    const dto: ValuationDto = {
      currency: currency("AED"),
      minor: minor("900719925474099300"),
      quoteIds,
      asOf: "2026-08-04" as ValuationDto["asOf"],
    };

    const valuation = valuationFromDto(dto);
    quoteIds.push("018f4f7e-8ead-7c0d-8000-000000000100");

    expect(valuation).toEqual({
      currency: "AED",
      minor: 900719925474099300n,
      quoteIds: ["018f4f7e-8ead-7c0d-8000-000000000099"],
      asOf: "2026-08-04",
    });
    expect(Object.isFrozen(valuation)).toBe(true);
    expect(Object.isFrozen(valuation.quoteIds)).toBe(true);
  });
});
