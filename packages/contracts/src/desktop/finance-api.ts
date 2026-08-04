import { z } from "zod";
import {
  AccountIdSchema,
  IsoDateSchema,
  WorkspaceIdSchema,
} from "../ids";
import { CurrencySchema, MinorUnitStringSchema } from "../money";

export const FinanceOverviewInputSchema = z.object({
  asOf: IsoDateSchema.optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/u).optional(),
  offline: z.boolean().optional(),
  now: z.string().datetime({ offset: true }).optional(),
}).strict();

export const FinanceBudgetProgressSchema = z.object({
  id: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/u),
  categoryAccountId: AccountIdSchema,
  currency: CurrencySchema,
  limitMinor: MinorUnitStringSchema,
  spentMinor: MinorUnitStringSchema,
  remainingMinor: MinorUnitStringSchema,
  rolloverMinor: MinorUnitStringSchema,
}).strict();

export const FinanceGoalProgressSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  targetCurrency: CurrencySchema,
  targetMinor: MinorUnitStringSchema,
  targetDate: IsoDateSchema,
  currentMinor: MinorUnitStringSchema,
  completionBasisPoints: z.number().int().min(0).max(10000),
  status: z.enum(["on-track", "complete", "missing-fx"]),
}).strict();

export const FinanceOverviewSchema = z.object({
  asOf: IsoDateSchema,
  month: z.string().regex(/^\d{4}-\d{2}$/u),
  baseCurrency: CurrencySchema,
  netWorthMinor: MinorUnitStringSchema.nullable(),
  incomeMinor: MinorUnitStringSchema,
  expenseMinor: MinorUnitStringSchema,
  cashFlowMinor: MinorUnitStringSchema,
  fxStatus: z.enum(["fresh", "stale", "missing"]),
  fxProvider: z.enum(["boc", "manual", "mixed"]).nullable(),
  fxAsOf: IsoDateSchema.nullable(),
  budgetCount: z.number().int().nonnegative(),
  goalCount: z.number().int().nonnegative(),
}).strict();

export const FinanceListBudgetsInputSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/u),
}).strict();

export const FinanceListGoalsInputSchema = z.object({}).strict();

export const FinanceUpsertBudgetInputSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/u),
  categoryAccountId: AccountIdSchema,
  currency: CurrencySchema,
  limitMinor: MinorUnitStringSchema,
}).strict();

export const FinanceUpsertGoalInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  target: z.object({ currency: CurrencySchema, minor: MinorUnitStringSchema }).strict(),
  targetDate: IsoDateSchema,
  linkedAccountIds: z.array(AccountIdSchema).min(1),
}).strict();

export const FinanceSettingsSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  baseCurrency: CurrencySchema,
  staleAfterDays: z.number().int().nonnegative(),
  autoFxEnabled: z.boolean(),
  version: z.number().int().nonnegative(),
}).strict();

export const FinanceSetBaseCurrencyInputSchema = z.object({
  baseCurrency: CurrencySchema,
  expectedVersion: z.number().int().nonnegative(),
}).strict();

export const FinanceSetFxOverrideInputSchema = z.object({
  id: z.string().uuid().optional(),
  from: CurrencySchema,
  to: CurrencySchema,
  numerator: MinorUnitStringSchema,
  denominator: MinorUnitStringSchema,
  asOf: IsoDateSchema,
}).strict();

export const FinanceFxOverrideSchema = z.object({
  id: z.string().uuid(),
  workspaceId: WorkspaceIdSchema,
  from: CurrencySchema,
  to: CurrencySchema,
  numerator: MinorUnitStringSchema,
  denominator: MinorUnitStringSchema,
  asOf: IsoDateSchema,
  deletedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();

export type FinanceOverviewInput = z.infer<typeof FinanceOverviewInputSchema>;
export type FinanceBudgetProgress = z.infer<typeof FinanceBudgetProgressSchema>;
export type FinanceGoalProgress = z.infer<typeof FinanceGoalProgressSchema>;
export type FinanceOverview = z.infer<typeof FinanceOverviewSchema>;
export type FinanceListBudgetsInput = z.infer<typeof FinanceListBudgetsInputSchema>;
export type FinanceUpsertBudgetInput = z.infer<typeof FinanceUpsertBudgetInputSchema>;
export type FinanceUpsertGoalInput = z.infer<typeof FinanceUpsertGoalInputSchema>;
export type FinanceSettings = z.infer<typeof FinanceSettingsSchema>;
export type FinanceSetBaseCurrencyInput = z.infer<typeof FinanceSetBaseCurrencyInputSchema>;
export type FinanceSetFxOverrideInput = z.infer<typeof FinanceSetFxOverrideInputSchema>;
export type FinanceFxOverride = z.infer<typeof FinanceFxOverrideSchema>;

export interface FinanceApi {
  overview(input?: FinanceOverviewInput): Promise<FinanceOverview>;
  listBudgets(input: FinanceListBudgetsInput): Promise<readonly FinanceBudgetProgress[]>;
  listGoals(): Promise<readonly FinanceGoalProgress[]>;
  upsertBudget(input: FinanceUpsertBudgetInput): Promise<FinanceBudgetProgress>;
  upsertGoal(input: FinanceUpsertGoalInput): Promise<FinanceGoalProgress>;
  getSettings(): Promise<FinanceSettings>;
  setBaseCurrency(input: FinanceSetBaseCurrencyInput): Promise<FinanceSettings>;
  setFxOverride(input: FinanceSetFxOverrideInput): Promise<FinanceFxOverride>;
  deleteFxOverride(input: FinanceSetFxOverrideInput & { id: string }): Promise<void>;
}
