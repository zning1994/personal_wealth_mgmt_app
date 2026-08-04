import { z } from "zod";

import { IsoDateSchema } from "./ids";
import type { Brand } from "./ids";

export type Currency = Brand<string, "Currency">;
export type MinorUnitString = Brand<string, "MinorUnitString">;

export const CurrencySchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/)
  .transform((value) => value.toUpperCase() as Currency);

export const MinorUnitStringSchema = z
  .string()
  .regex(/^-?(0|[1-9]\d*)$/)
  .transform((value) => value as MinorUnitString);

export const MoneyDtoSchema = z
  .object({
    currency: CurrencySchema,
    minor: MinorUnitStringSchema,
  })
  .strict();

export type MoneyDto = z.infer<typeof MoneyDtoSchema>;

export const CommodityDtoSchema = z
  .object({
    code: z.string().min(1),
    scale: z.number().int().min(0).max(18),
  })
  .strict();

export type CommodityDto = z.infer<typeof CommodityDtoSchema>;

export const ValuationDtoSchema = z
  .object({
    currency: CurrencySchema,
    minor: MinorUnitStringSchema,
    quoteIds: z.array(z.string().uuid()).readonly(),
    asOf: IsoDateSchema,
  })
  .strict();

export type ValuationDto = z.infer<typeof ValuationDtoSchema>;

export function parseMoneyDto(input: unknown): MoneyDto {
  return MoneyDtoSchema.parse(input);
}
