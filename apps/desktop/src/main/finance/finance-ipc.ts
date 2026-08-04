import {
  FinanceBudgetProgressSchema,
  FinanceGoalProgressSchema,
  FinanceOverviewInputSchema,
  FinanceOverviewSchema,
  FinanceSettingsSchema,
  FinanceUpsertBudgetInputSchema,
  FinanceUpsertGoalInputSchema,
  FinanceListBudgetsInputSchema,
  FinanceSetBaseCurrencyInputSchema,
  FinanceFxOverrideSchema,
  FinanceSetFxOverrideInputSchema,
} from "@pwm/contracts";
import type { DesktopFinanceService } from "./finance-service";

export interface FinanceIpcRegistrar {
  handle(channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>): void;
  removeHandler?(channel: string): void;
}

const channels = [
  "finance:overview",
  "finance:list-budgets",
  "finance:list-goals",
  "finance:upsert-budget",
  "finance:upsert-goal",
  "finance:get-settings",
  "finance:set-base-currency",
  "finance:set-fx-override",
  "finance:delete-fx-override",
] as const;

export function registerFinanceIpc(ipc: FinanceIpcRegistrar, service: DesktopFinanceService): () => void {
  ipc.handle("finance:overview", async (_event, payload) => FinanceOverviewSchema.parse(await service.overview(FinanceOverviewInputSchema.parse(payload ?? {}))));
  ipc.handle("finance:list-budgets", async (_event, payload) => (await service.listBudgets(FinanceListBudgetsInputSchema.parse(payload))).map((value) => FinanceBudgetProgressSchema.parse(value)));
  ipc.handle("finance:list-goals", async () => (await service.listGoals()).map((value) => FinanceGoalProgressSchema.parse(value)));
  ipc.handle("finance:upsert-budget", async (_event, payload) => FinanceBudgetProgressSchema.parse(await service.upsertBudget(FinanceUpsertBudgetInputSchema.parse(payload))));
  ipc.handle("finance:upsert-goal", async (_event, payload) => FinanceGoalProgressSchema.parse(await service.upsertGoal(FinanceUpsertGoalInputSchema.parse(payload))));
  ipc.handle("finance:get-settings", async () => FinanceSettingsSchema.parse(await service.getSettings()));
  ipc.handle("finance:set-base-currency", async (_event, payload) => FinanceSettingsSchema.parse(await service.setBaseCurrency(FinanceSetBaseCurrencyInputSchema.parse(payload))));
  ipc.handle("finance:set-fx-override", async (_event, payload) => FinanceFxOverrideSchema.parse(await service.setFxOverride(FinanceSetFxOverrideInputSchema.parse(payload))));
  ipc.handle("finance:delete-fx-override", async (_event, payload) => { const value = FinanceSetFxOverrideInputSchema.parse(payload); if (!value.id) throw new Error("FX_OVERRIDE_ID_REQUIRED"); await service.deleteFxOverride({ ...value, id: value.id }); return undefined; });
  return () => { for (const channel of channels) ipc.removeHandler?.(channel); };
}
