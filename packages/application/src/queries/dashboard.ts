import type { Currency, DashboardDto, WorkspaceId } from "@pwm/contracts";
import type { Money } from "@pwm/domain";
import type { FinanceRepository } from "../ports/finance-repository";
import type { BalanceSheetProjection, BalanceSheetQuery } from "./balance-sheet";
import type { BudgetProgress, BudgetProgressQuery } from "../commands/manage-budget";
import type { GoalProgress, GoalProgressQuery } from "../commands/manage-goal";

export interface DashboardSnapshot {
  readonly asOf: string;
  readonly baseCurrency: Currency;
  readonly netWorth: Money | null;
  readonly cashFlow: {
    readonly incomeMinor: bigint;
    readonly expenseMinor: bigint;
    readonly netMinor: bigint;
  };
  readonly budgets: readonly BudgetProgress[];
  readonly goals: readonly GoalProgress[];
  readonly fx: {
    readonly status: "fresh" | "stale" | "missing";
    readonly provider: "boc" | "manual" | "mixed" | null;
    readonly asOf: string | null;
  };
}

/** Convert the bigint-rich application projection at the IPC boundary. */
export function dashboardSnapshotToDto(snapshot: DashboardSnapshot): DashboardDto {
  return {
    asOf: snapshot.asOf,
    baseCurrency: snapshot.baseCurrency,
    netWorthMinor: snapshot.netWorth?.minor.toString() as DashboardDto["netWorthMinor"],
    cashFlowMinor: snapshot.cashFlow.netMinor.toString() as DashboardDto["cashFlowMinor"],
    fxStatus: snapshot.fx.status,
    fxProvider: snapshot.fx.provider,
    fxAsOf: snapshot.fx.asOf,
    budgetCount: snapshot.budgets.length,
    goalCount: snapshot.goals.length,
  };
}

export class DashboardQuery {
  constructor(
    private readonly repository: FinanceRepository,
    private readonly balanceSheet: Pick<BalanceSheetQuery, "execute">,
    private readonly budgets: Pick<BudgetProgressQuery, "execute">,
    private readonly goals: Pick<GoalProgressQuery, "execute">,
  ) {}

  /** Small deterministic seam for renderer/application tests. */
  static withFakes(
    repository: FinanceRepository,
    projection: Pick<BalanceSheetProjection, "netWorth" | "fxStatus" | "fxAsOf" | "fxProvider">,
  ): DashboardQuery {
    return new DashboardQuery(
      repository,
      {
        execute: async () => ({
          ...projection,
          assets: [],
          liabilities: [],
          assetTotal: null,
          liabilityTotal: null,
        }),
      } as Pick<BalanceSheetQuery, "execute">,
      { execute: async () => ({}) as BudgetProgress } as Pick<BudgetProgressQuery, "execute">,
      { execute: async () => ({}) as GoalProgress } as Pick<GoalProgressQuery, "execute">,
    );
  }

  async execute(input: {
    readonly workspaceId: WorkspaceId;
    readonly month: string;
    readonly asOf: string;
    readonly offline: boolean;
    readonly now: string;
  }): Promise<DashboardSnapshot> {
    const settings = await this.repository.getSettings(input.workspaceId);
    const [sheet, cash, budgets, goals] = await Promise.all([
      this.balanceSheet.execute({
        workspaceId: input.workspaceId,
        asOf: input.asOf,
        offline: input.offline,
        now: input.now,
      }),
      this.repository.sumCashFlow({
        workspaceId: input.workspaceId,
        month: input.month,
        currency: settings.baseCurrency,
        excludeTransferLinks: true,
      }),
      this.repository.listBudgets(input.workspaceId, input.month),
      this.repository.listGoals(input.workspaceId),
    ]);
    const budgetProgress = await Promise.all(
      budgets.map((budget) =>
        this.budgets.execute({
          workspaceId: input.workspaceId,
          month: input.month,
          categoryAccountId: budget.categoryAccountId,
        }),
      ),
    );
    const goalProgress = await Promise.all(
      goals.map((goal) =>
        this.goals.execute({
          goalId: goal.id,
          asOf: input.asOf,
          offline: input.offline,
          now: input.now,
        }),
      ),
    );
    return {
      asOf: input.asOf,
      baseCurrency: settings.baseCurrency,
      netWorth: sheet.netWorth,
      cashFlow: {
        incomeMinor: cash.income.minor,
        expenseMinor: cash.expense.minor,
        netMinor: cash.income.minor - cash.expense.minor,
      },
      budgets: budgetProgress,
      goals: goalProgress,
      fx: {
        status: sheet.fxStatus,
        provider: sheet.fxProvider,
        asOf: sheet.fxAsOf,
      },
    };
  }
}
