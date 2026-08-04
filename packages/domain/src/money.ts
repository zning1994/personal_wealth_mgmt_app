import type {
  CommodityDto,
  Currency,
  MinorUnitString,
  MoneyDto,
  ValuationDto,
} from "@pwm/contracts";

export interface Money {
  readonly currency: Currency;
  readonly minor: bigint;
}

export interface CommodityQuantity {
  readonly commodity: CommodityDto;
  readonly units: bigint;
}

export interface Valuation {
  readonly currency: Currency;
  readonly minor: bigint;
  readonly quoteIds: readonly string[];
  readonly asOf: string;
}

export function moneyFromDto(dto: MoneyDto): Money {
  return Object.freeze({
    currency: dto.currency,
    minor: BigInt(dto.minor),
  });
}

export function moneyToDto(money: Money): MoneyDto {
  return Object.freeze({
    currency: money.currency,
    minor: money.minor.toString() as MinorUnitString,
  });
}

export function addMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) {
    throw new Error(`Currency mismatch: ${left.currency}/${right.currency}`);
  }

  return Object.freeze({
    currency: left.currency,
    minor: left.minor + right.minor,
  });
}

export function sumMoney(
  currency: Currency,
  values: readonly Money[],
): Money {
  return values.reduce(addMoney, Object.freeze({ currency, minor: 0n }));
}

export function addCommodity(
  left: CommodityQuantity,
  right: CommodityQuantity,
): CommodityQuantity {
  if (
    left.commodity.code !== right.commodity.code ||
    left.commodity.scale !== right.commodity.scale
  ) {
    throw new Error("Commodity mismatch");
  }

  const commodity = Object.freeze({
    code: left.commodity.code,
    scale: left.commodity.scale,
  });

  return Object.freeze({
    commodity,
    units: left.units + right.units,
  });
}

export function valuationFromDto(dto: ValuationDto): Valuation {
  return Object.freeze({
    currency: dto.currency,
    minor: BigInt(dto.minor),
    quoteIds: Object.freeze([...dto.quoteIds]),
    asOf: dto.asOf,
  });
}
