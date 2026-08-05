import { z } from "zod";
import { AccountIdSchema, IsoDateSchema, WorkspaceIdSchema } from "./ids";
import { CurrencySchema, MinorUnitStringSchema } from "./money";

const PositiveMinorUnitStringSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform((value) => value as z.infer<typeof MinorUnitStringSchema>);

export const FxRateFieldSchema = z.enum(["spot_buy", "cash_buy", "spot_sell", "cash_sell", "conversion"]);
export type FxRateField = z.infer<typeof FxRateFieldSchema>;

export const FxQuoteDtoSchema = z.object({
  id: z.string().uuid(), provider: z.literal("boc"), foreignCurrency: CurrencySchema,
  cnyPer100: z.string().regex(/^\d+(?:\.\d+)?$/), field: FxRateFieldSchema,
  asOf: IsoDateSchema, publishedAtUtc: z.string().datetime(), fetchedAt: z.string().datetime(),
  etag: z.string().nullable(), payloadHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
export type FxQuoteDto = z.infer<typeof FxQuoteDtoSchema>;

export const FxOverrideDtoSchema = z.object({
  id: z.string().uuid(), workspaceId: WorkspaceIdSchema, from: CurrencySchema, to: CurrencySchema,
  numerator: MinorUnitStringSchema, denominator: PositiveMinorUnitStringSchema, asOf: IsoDateSchema,
  deletedAt: z.string().datetime().nullable(),
}).strict();
export type FxOverrideDto = z.infer<typeof FxOverrideDtoSchema>;

export const BudgetDtoSchema = z.object({
  id: z.string().uuid(), workspaceId: WorkspaceIdSchema, month: z.string().regex(/^\d{4}-\d{2}$/),
  categoryAccountId: AccountIdSchema, currency: CurrencySchema, limitMinor: MinorUnitStringSchema,
}).strict();
export type BudgetDto = z.infer<typeof BudgetDtoSchema>;

export const GoalDtoSchema = z.object({
  id: z.string().uuid(), workspaceId: WorkspaceIdSchema, name: z.string().min(1),
  target: z.object({ currency: CurrencySchema, minor: MinorUnitStringSchema }).strict(),
  targetDate: IsoDateSchema, linkedAccountIds: z.array(AccountIdSchema),
}).strict();
export type GoalDto = z.infer<typeof GoalDtoSchema>;

export const DashboardDtoSchema = z.object({
  asOf: IsoDateSchema, baseCurrency: CurrencySchema, netWorthMinor: MinorUnitStringSchema.nullable(),
  cashFlowMinor: MinorUnitStringSchema.nullable(), fxStatus: z.enum(["fresh", "stale", "missing"]),
  fxProvider: z.enum(["boc", "manual", "mixed"]).nullable(), fxAsOf: IsoDateSchema.nullable(),
  budgetCount: z.number().int().nonnegative(), goalCount: z.number().int().nonnegative(),
}).strict();
export type DashboardDto = z.infer<typeof DashboardDtoSchema>;
