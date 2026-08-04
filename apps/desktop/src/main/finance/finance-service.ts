import { randomUUID } from "node:crypto";
import type {
  FinanceApi,
  FinanceBudgetProgress,
  FinanceGoalProgress,
  FinanceOverview,
  FinanceOverviewInput,
  FinanceSettings,
  FinanceFxOverride,
  FinanceUpsertBudgetInput,
  FinanceUpsertGoalInput,
  FinanceSetFxOverrideInput,
  WorkspaceId,
} from "@pwm/contracts";
import {
  BalanceSheetQuery,
  BudgetProgressQuery,
  DashboardQuery,
  GoalProgressQuery,
  UpsertBudgetCommand,
  UpsertGoalCommand,
  SaveFxOverrideCommand,
  DeleteFxOverrideCommand,
  ValuationService,
  ChangeBaseCurrencyCommand,
  type FinancialGoal,
  type MonthlyBudget,
} from "@pwm/application";
import type { Money } from "@pwm/domain";
import { FxResolver } from "@pwm/fx";
import {
  createSqlFinanceRepository,
  createSqlFxRateStore,
  type SqlCipherConnection,
} from "@pwm/storage";

export type DesktopFinanceService = FinanceApi;

const dateOnly = (value: string): string => value.slice(0, 10);
const currentNow = (): string => new Date().toISOString();
const currentDate = (): string => dateOnly(currentNow());
const currentMonth = (date: string): string => date.slice(0, 7);
const minorString = (value: bigint): FinanceOverview["netWorthMinor"] =>
  value.toString() as FinanceOverview["netWorthMinor"];

function budgetProgressView(
  budget: MonthlyBudget,
  progress: { readonly spentMinor: bigint; readonly remainingMinor: bigint },
): FinanceBudgetProgress {
  return {
    id: budget.id,
    month: budget.month,
    categoryAccountId: budget.categoryAccountId,
    currency: budget.currency,
    limitMinor: budget.limitMinor.toString() as FinanceBudgetProgress["limitMinor"],
    spentMinor: progress.spentMinor.toString() as FinanceBudgetProgress["spentMinor"],
    remainingMinor: progress.remainingMinor.toString() as FinanceBudgetProgress["remainingMinor"],
    rolloverMinor: "0" as FinanceBudgetProgress["rolloverMinor"],
  };
}

function goalProgressView(goal: FinancialGoal, progress: {
  readonly currentMinor: bigint;
  readonly completionBasisPoints: number;
  readonly status: "on-track" | "complete" | "missing-fx";
}): FinanceGoalProgress {
  return {
    id: goal.id,
    name: goal.name,
    targetCurrency: goal.target.currency,
    targetMinor: goal.target.minor.toString() as FinanceGoalProgress["targetMinor"],
    targetDate: goal.targetDate,
    currentMinor: progress.currentMinor.toString() as FinanceGoalProgress["currentMinor"],
    completionBasisPoints: progress.completionBasisPoints,
    status: progress.status,
  };
}

export function createSqlFinanceService(input: {
  readonly workspaceId: WorkspaceId;
  readonly connection: SqlCipherConnection;
  readonly now?: () => string;
}): DesktopFinanceService {
  const now = input.now ?? currentNow;
  const repository = createSqlFinanceRepository(input.connection);
  const fxStore = createSqlFxRateStore(input.connection, input.workspaceId);
  const fx = new FxResolver(fxStore);
  const valuation = new ValuationService(repository, fx);
  const balanceSheet = new BalanceSheetQuery(repository, valuation);
  const budgetProgress = new BudgetProgressQuery(repository);
  const goalProgress = new GoalProgressQuery(repository, valuation);
  const dashboard = new DashboardQuery(repository, balanceSheet, budgetProgress, goalProgress);
  const budgetCommand = new UpsertBudgetCommand(repository, randomUUID);
  const goalCommand = new UpsertGoalCommand(repository, randomUUID);
  const baseCurrencyCommand = new ChangeBaseCurrencyCommand(repository);
  const saveFxOverride = new SaveFxOverrideCommand(fxStore, randomUUID);
  const deleteFxOverride = new DeleteFxOverrideCommand(fxStore);

  const resolveQuery = (query?: FinanceOverviewInput) => {
    const resolvedNow = query?.now ?? now();
    const asOf = query?.asOf ?? dateOnly(resolvedNow);
    const month = query?.month ?? currentMonth(asOf);
    return { asOf, month, now: resolvedNow, offline: query?.offline ?? true };
  };

  const listBudgetProgress = async (month: string): Promise<readonly FinanceBudgetProgress[]> => {
    const budgets = await repository.listBudgets(input.workspaceId, month);
    return Promise.all(
      budgets.map(async (budget) => budgetProgressView(
        budget,
        await budgetProgress.execute({
          workspaceId: input.workspaceId,
          month,
          categoryAccountId: budget.categoryAccountId,
        }),
      )),
    );
  };

  const listGoalProgress = async (query: { asOf: string; now: string; offline: boolean }): Promise<readonly FinanceGoalProgress[]> => {
    const goals = await repository.listGoals(input.workspaceId);
    return Promise.all(
      goals.map(async (goal) => goalProgressView(
        goal,
        await goalProgress.execute({ goalId: goal.id, ...query }),
      )),
    );
  };

  return {
    async overview(query) {
      const resolved = resolveQuery(query);
      const snapshot = await dashboard.execute({ workspaceId: input.workspaceId, ...resolved });
      return {
        asOf: snapshot.asOf,
        month: resolved.month,
        baseCurrency: snapshot.baseCurrency,
        netWorthMinor: snapshot.netWorth === null ? null : minorString(snapshot.netWorth.minor),
        incomeMinor: snapshot.cashFlow.incomeMinor.toString() as FinanceOverview["incomeMinor"],
        expenseMinor: snapshot.cashFlow.expenseMinor.toString() as FinanceOverview["expenseMinor"],
        cashFlowMinor: snapshot.cashFlow.netMinor.toString() as FinanceOverview["cashFlowMinor"],
        fxStatus: snapshot.fx.status,
        fxProvider: snapshot.fx.provider,
        fxAsOf: snapshot.fx.asOf,
        budgetCount: snapshot.budgets.length,
        goalCount: snapshot.goals.length,
      };
    },
    listBudgets: async ({ month }) => listBudgetProgress(month),
    listGoals: async () => listGoalProgress({ asOf: currentDate(), now: now(), offline: true }),
    async upsertBudget(value: FinanceUpsertBudgetInput) {
      const budget = await budgetCommand.execute({
        workspaceId: input.workspaceId,
        month: value.month,
        categoryAccountId: value.categoryAccountId,
        currency: value.currency,
        limitMinor: BigInt(value.limitMinor),
      });
      const progress = await budgetProgress.execute({ workspaceId: input.workspaceId, month: value.month, categoryAccountId: value.categoryAccountId });
      return budgetProgressView(budget, progress);
    },
    async upsertGoal(value: FinanceUpsertGoalInput) {
      const goal = await goalCommand.execute({
        ...(value.id === undefined ? {} : { id: value.id }),
        workspaceId: input.workspaceId,
        name: value.name,
        target: { currency: value.target.currency, minor: BigInt(value.target.minor) } as Money,
        targetDate: value.targetDate,
        linkedAccountIds: value.linkedAccountIds,
      });
      const progress = await goalProgress.execute({ goalId: goal.id, asOf: currentDate(), now: now(), offline: true });
      return goalProgressView(goal, progress);
    },
    async getSettings() {
      const settings = await repository.getSettings(input.workspaceId);
      return settings as FinanceSettings;
    },
    async setBaseCurrency(value) {
      await baseCurrencyCommand.execute({ workspaceId: input.workspaceId, ...value });
      return repository.getSettings(input.workspaceId);
    },
    async setFxOverride(value: FinanceSetFxOverrideInput): Promise<FinanceFxOverride> {
      const saved = await saveFxOverride.execute({
        ...(value.id === undefined ? {} : { id: value.id }),
        workspaceId: input.workspaceId,
        from: value.from,
        to: value.to,
        numerator: BigInt(value.numerator),
        denominator: BigInt(value.denominator),
        asOf: value.asOf,
      });
      return { id: saved.id, workspaceId: saved.workspaceId, from: saved.rate.from, to: saved.rate.to, numerator: saved.rate.numerator.toString() as FinanceFxOverride["numerator"], denominator: saved.rate.denominator.toString() as FinanceFxOverride["denominator"], asOf: saved.rate.asOf, deletedAt: null };
    },
    async deleteFxOverride(value) {
      await deleteFxOverride.execute({ workspaceId: input.workspaceId, id: value.id, from: value.from, to: value.to, asOf: value.asOf, deletedAt: now() });
    },
  };
}

export function createInMemoryFinanceService(workspaceId: WorkspaceId): DesktopFinanceService {
  const budgets: FinanceBudgetProgress[] = [];
  const goals: FinanceGoalProgress[] = [];
  let settings: FinanceSettings = { workspaceId, baseCurrency: "AED" as never, staleAfterDays: 7, autoFxEnabled: true, version: 0 };
  return {
    async overview(input) {
      const asOf = input?.asOf ?? currentDate();
      const month = input?.month ?? currentMonth(asOf);
      return { asOf, month, baseCurrency: settings.baseCurrency, netWorthMinor: null, incomeMinor: "0" as never, expenseMinor: "0" as never, cashFlowMinor: "0" as never, fxStatus: "missing", fxProvider: null, fxAsOf: null, budgetCount: budgets.filter((item) => item.month === month).length, goalCount: goals.length };
    },
    async listBudgets({ month }) { return budgets.filter((item) => item.month === month); },
    async listGoals() { return goals; },
    async upsertBudget(value) {
      const existing = budgets.find((item) => item.month === value.month && item.categoryAccountId === value.categoryAccountId);
      const next: FinanceBudgetProgress = { id: existing?.id ?? randomUUID(), month: value.month, categoryAccountId: value.categoryAccountId, currency: value.currency, limitMinor: value.limitMinor, spentMinor: "0" as never, remainingMinor: value.limitMinor, rolloverMinor: "0" as never };
      if (existing) budgets[budgets.indexOf(existing)] = next; else budgets.push(next);
      return next;
    },
    async upsertGoal(value) {
      const next: FinanceGoalProgress = { id: value.id ?? randomUUID(), name: value.name.trim(), targetCurrency: value.target.currency, targetMinor: value.target.minor, targetDate: value.targetDate, currentMinor: "0" as never, completionBasisPoints: 0, status: "on-track" };
      const index = goals.findIndex((goal) => goal.id === next.id);
      if (index >= 0) goals[index] = next; else goals.push(next);
      return next;
    },
    async getSettings() { return settings; },
    async setBaseCurrency(value) { settings = { ...settings, baseCurrency: value.baseCurrency, version: settings.version + 1 }; return settings; },
    async setFxOverride(value) { return { id: value.id ?? randomUUID(), workspaceId, from: value.from, to: value.to, numerator: value.numerator, denominator: value.denominator, asOf: value.asOf, deletedAt: null }; },
    async deleteFxOverride() { return undefined; },
  };
}
