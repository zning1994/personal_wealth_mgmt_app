import type { Currency, FxRateField } from "@pwm/contracts";
import type { Money } from "@pwm/domain";
import type { BocRateWire } from "./schemas";

export interface RationalRate { from: Currency; to: Currency; numerator: bigint; denominator: bigint; quoteIds: readonly string[]; asOf: string; }
const pow10 = (digits: number) => 10n ** BigInt(digits);
const gcd = (a: bigint, b: bigint): bigint => b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b);
const reduce = (n: bigint, d: bigint) => { const divisor = gcd(n, d); return [n / divisor, d / divisor] as const; };
export function parseDecimal(value: string): { units: bigint; scale: bigint } {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("INVALID_DECIMAL");
  const [whole, fraction = ""] = value.split(".");
  return { units: BigInt(`${whole}${fraction}`), scale: pow10(fraction.length) };
}
export function normalizeBocRate(input: { quoteId: string; rate: BocRateWire; field: FxRateField; foreignMinorDigits: number; cnyMinorDigits?: number }): RationalRate {
  const raw = input.rate[input.field];
  if (raw === null) throw new Error("MISSING_FX_RATE");
  const decimal = parseDecimal(String(raw));
  const [numerator, denominator] = reduce(decimal.units * pow10(input.cnyMinorDigits ?? 2), 100n * pow10(input.foreignMinorDigits) * decimal.scale);
  const asOf = `${input.rate.as_of_date.slice(0, 4)}-${input.rate.as_of_date.slice(4, 6)}-${input.rate.as_of_date.slice(6, 8)}`;
  return { from: input.rate.code as Currency, to: "CNY" as Currency, numerator, denominator, quoteIds: [input.quoteId], asOf };
}
function divideHalfEven(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error("INVALID_RATE_DENOMINATOR");
  const sign = n < 0n ? -1n : 1n; const positive = n < 0n ? -n : n; const q = positive / d; const r = positive % d;
  const rounded = r * 2n < d ? q : r * 2n > d ? q + 1n : q % 2n === 0n ? q : q + 1n;
  return sign * rounded;
}
export function convertMinor(amount: Money, rate: RationalRate): Money {
  if (amount.currency !== rate.from) throw new Error("FX_CURRENCY_MISMATCH");
  return { currency: rate.to, minor: divideHalfEven(amount.minor * rate.numerator, rate.denominator) };
}
export function crossViaCny(fromCny: RationalRate, toCny: RationalRate): RationalRate {
  if (fromCny.to !== "CNY" || toCny.to !== "CNY" || fromCny.asOf !== toCny.asOf) throw new Error("FX_CROSS_REQUIRES_SAME_DAY");
  const [numerator, denominator] = reduce(fromCny.numerator * toCny.denominator, fromCny.denominator * toCny.numerator);
  return { from: fromCny.from, to: toCny.from, numerator, denominator, quoteIds: [...fromCny.quoteIds, ...toCny.quoteIds], asOf: fromCny.asOf };
}
