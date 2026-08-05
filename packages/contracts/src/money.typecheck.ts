import type {
  CommodityDto,
  Currency,
  MinorUnitString,
  MoneyDto,
  ValuationDto,
} from "./money";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;

type Expect<Value extends true> = Value;

export type MoneyDtoReadonlyContract = Expect<
  Equal<
    MoneyDto,
    Readonly<{
      currency: Currency;
      minor: MinorUnitString;
    }>
  >
>;

export type CommodityDtoReadonlyContract = Expect<
  Equal<
    CommodityDto,
    Readonly<{
      code: string;
      scale: number;
    }>
  >
>;

export type ValuationDtoReadonlyContract = Expect<
  Equal<
    ValuationDto,
    Readonly<{
      currency: Currency;
      minor: MinorUnitString;
      quoteIds: readonly string[];
      asOf: string;
    }>
  >
>;
