import type { AccountId, Currency, WorkspaceId } from "@pwm/contracts";
import type { AccountKind, Money } from "@pwm/domain";

/** Workspace settings that affect projections only.  Original postings never
 * change when one of these values changes. */
export interface WorkspaceFinanceSettings {
  readonly workspaceId: WorkspaceId;
  readonly baseCurrency: Currency;
  readonly staleAfterDays: number;
  readonly autoFxEnabled: boolean;
  readonly version: number;
}

export interface AccountBalance {
  readonly accountId: AccountId;
  readonly name: string;
  readonly kind: AccountKind;
  readonly balance: Money;
}

export interface MonthlyBudget {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly month: string;
  readonly categoryAccountId: AccountId;
  readonly currency: Currency;
  readonly limitMinor: bigint;
  readonly version: number;
}

export interface FinancialGoal {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly target: Money;
  readonly targetDate: string;
  readonly linkedAccountIds: readonly AccountId[];
  readonly version: number;
}

export interface CashFlowTotals {
  readonly income: Money;
  readonly expense: Money;
}

/**
 * Application-facing persistence boundary for finance projections.  Adapters
 * may derive all rows from immutable journals, but must not mutate original
 * money as a side effect of settings or report queries.
 */
export interface FinanceRepository {
  getSettings(workspaceId: WorkspaceId): Promise<WorkspaceFinanceSettings>;
  updateBaseCurrency(
    workspaceId: WorkspaceId,
    baseCurrency: Currency,
    expectedVersion: number,
  ): Promise<void>;
  countOriginalMoneyMutations(): Promise<number>;

  listAccountBalances(input: {
    readonly workspaceId: WorkspaceId;
    readonly asOf: string;
    readonly kinds: readonly AccountKind[];
  }): Promise<readonly AccountBalance[]>;

  saveBudget(
    budget: MonthlyBudget,
    expectedVersion: number | null,
  ): Promise<void>;
  findBudget(
    workspaceId: WorkspaceId,
    month: string,
    categoryAccountId: AccountId,
  ): Promise<MonthlyBudget | null>;
  sumCategoryExpense(input: {
    readonly workspaceId: WorkspaceId;
    readonly month: string;
    readonly categoryAccountId: AccountId;
    readonly currency: Currency;
  }): Promise<Money>;

  saveGoal(goal: FinancialGoal, expectedVersion: number | null): Promise<void>;
  findGoal(id: string): Promise<FinancialGoal | null>;
  listGoals(workspaceId: WorkspaceId): Promise<readonly FinancialGoal[]>;
  listBalancesForAccounts(
    workspaceId: WorkspaceId,
    accountIds: readonly AccountId[],
    asOf: string,
  ): Promise<readonly Money[]>;

  sumCashFlow(input: {
    readonly workspaceId: WorkspaceId;
    readonly month: string;
    readonly currency: Currency;
    readonly excludeTransferLinks: true;
  }): Promise<CashFlowTotals>;
  listBudgets(
    workspaceId: WorkspaceId,
    month: string,
  ): Promise<readonly MonthlyBudget[]>;
}
