import { z } from "zod";

export const BocRateWireSchema = z.object({
  code: z.string().regex(/^[A-Z]{3}$/), name_zh: z.string().min(1), as_of_date: z.string().regex(/^\d{8}$/),
  spot_buy: z.number().nonnegative().nullable(), cash_buy: z.number().nonnegative().nullable(),
  spot_sell: z.number().nonnegative().nullable(), cash_sell: z.number().nonnegative().nullable(),
  conversion: z.number().nonnegative().nullable(), published_at_utc: z.string().datetime(),
  published_at: z.string().datetime({ offset: true }),
}).strict();
export type BocRateWire = z.infer<typeof BocRateWireSchema>;
const metaTz = z.object({ tz: z.string().min(1) }).passthrough();
export const BocCurrenciesResponseSchema = z.object({ data: z.array(z.object({ code: z.string().regex(/^[A-Z]{3}$/), name_zh: z.string().min(1) }).strict()), meta: z.object({ count: z.number().int().nonnegative() }).passthrough() }).strict();
export const BocLatestOneResponseSchema = z.object({ data: BocRateWireSchema, meta: metaTz }).strict();
export const BocLatestAllResponseSchema = z.object({ data: z.array(BocRateWireSchema), meta: metaTz.extend({ count: z.number().int().nonnegative() }) }).strict();
export const BocHistoricalResponseSchema = z.object({ data: z.array(BocRateWireSchema), meta: z.object({ code: z.string(), from: z.string().regex(/^\d{8}$/), to: z.string().regex(/^\d{8}$/), tz: z.string(), count: z.number().int().nonnegative() }).strict() }).strict();
