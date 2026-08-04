import type { AccountId, Currency, WorkspaceId } from "@pwm/contracts";
import type { AccountKind, Money } from "@pwm/domain";
import type {
  AccountBalance,
  CashFlowTotals,
  FinanceRepository,
  FinancialGoal,
  MonthlyBudget,
  WorkspaceFinanceSettings,
} from "../../src/ports/finance-repository";

const DEFAULT_WORKSPACE =
  "00000000-0000-4000-8000-000000000001" as WorkspaceId;

export class InMemoryFinanceRepository implements FinanceRepository {
  readonly workspaceId: WorkspaceId;
  settings: WorkspaceFinanceSettings;
  accountBalances: AccountBalance[] = [];
  readonly budgets = new Map<string, MonthlyBudget>();
  readonly goals = new Map<string, FinancialGoal>();
  readonly linkedBalances = new Map<AccountId, Money>();
  readonly categoryExpenseMinor = new Map<string, bigint>();
  cashFlow: CashFlowTotals = {
    income: { currency: "AED" as Currency, minor: 0n },
    expense: { currency: "AED" as Currency, minor: 0n },
  };
  lastCashFlowInput:
    | {
        readonly workspaceId: WorkspaceId;
        readonly month: string;
        readonly currency: Currency;
        readonly excludeTransferLinks: true;
      }
    | undefined;
  private originalMoneyMutations = 0;

  constructor(baseCurrency: Currency, workspaceId: WorkspaceId = DEFAULT_WORKSPACE) {
    this.workspaceId = workspaceId;
    this.settings = {
      workspaceId,
      baseCurrency,
      staleAfterDays: 7,
      autoFxEnabled: true,
      version: 0,
    };
  }

  async getSettings(workspaceId: WorkspaceId): Promise<WorkspaceFinanceSettings> {
    this.assertWorkspace(workspaceId);
    return this.settings;
  }

  async updateBaseCurrency(
    workspaceId: WorkspaceId,
    baseCurrency: Currency,
    expectedVersion: number,
  ): Promise<void> {
    this.assertWorkspace(workspaceId);
    if (this.settings.version !== expectedVersion) throw new Error("VERSION_CONFLICT");
    this.settings = { ...this.settings, baseCurrency, version: expectedVersion + 1 };
  }

  async countOriginalMoneyMutations(): Promise<number> {
    return this.originalMoneyMutations;
  }

  async listAccountBalances(input: {
    readonly workspaceId: WorkspaceId;
    readonly asOf: string;
    readonly kinds: readonly AccountKind[];
  }): Promise<readonly AccountBalance[]> {
    this.assertWorkspace(input.workspaceId);
    void input.asOf;
    const kinds = new Set(input.kinds);
    return this.accountBalances.filter((row) => kinds.has(row.kind));
  }

  async saveBudget(budget: MonthlyBudget, expectedVersion: number | null): Promise<void> {
    this.assertWorkspace(budget.workspaceId);
    const key = this.budgetKey(budget.workspaceId, budget.month, budget.categoryAccountId);
    const existing = this.budgets.get(key);
    if ((existing?.version ?? null) !== expectedVersion) throw new Error("VERSION_CONFLICT");
    this.budgets.set(key, budget);
  }

  async findBudget(
    workspaceId: WorkspaceId,
    month: string,
    categoryAccountId: AccountId,
  ): Promise<MonthlyBudget | null> {
    return this.budgets.get(this.budgetKey(workspaceId, month, categoryAccountId)) ?? null;
  }

  async sumCategoryExpense(input: {
    readonly workspaceId: WorkspaceId;
    readonly month: string;
    readonly categoryAccountId: AccountId;
    readonly currency: Currency;
  }): Promise<Money> {
    this.assertWorkspace(input.workspaceId);
    return {
      currency: input.currency,
      minor: this.categoryExpenseMinor.get(`${input.month}:${input.categoryAccountId}`) ?? 0n,
    };
  }

  async saveGoal(goal: FinancialGoal, expectedVersion: number | null): Promise<void> {
    this.assertWorkspace(goal.workspaceId);
    const existing = this.goals.get(goal.id);
    if ((existing?.version ?? null) !== expectedVersion) throw new Error("VERSION_CONFLICT");
    this.goals.set(goal.id, goal);
  }

  async findGoal(id: string): Promise<FinancialGoal | null> {
    return this.goals.get(id) ?? null;
  }

  async listGoals(workspaceId: WorkspaceId): Promise<readonly FinancialGoal[]> {
    this.assertWorkspace(workspaceId);
    return [...this.goals.values()].filter((goal) => goal.workspaceId === workspaceId);
  }

  async listBalancesForAccounts(
    workspaceId: WorkspaceId,
    accountIds: readonly AccountId[],
    asOf: string,
  ): Promise<readonly Money[]> {
    this.assertWorkspace(workspaceId);
    void asOf;
    return accountIds.flatMap((id) => {
      const balance = this.linkedBalances.get(id);
      return balance === undefined ? [] : [balance];
    });
  }

  async sumCashFlow(input: {
    readonly workspaceId: WorkspaceId;
    readonly month: string;
    readonly currency: Currency;
    readonly excludeTransferLinks: true;
  }): Promise<CashFlowTotals> {
    this.assertWorkspace(input.workspaceId);
    this.lastCashFlowInput = input;
    void input.month;
    void input.excludeTransferLinks;
    return {
      income: { ...this.cashFlow.income, currency: input.currency },
      expense: { ...this.cashFlow.expense, currency: input.currency },
    };
  }

  async listBudgets(workspaceId: WorkspaceId, month: string): Promise<readonly MonthlyBudget[]> {
    this.assertWorkspace(workspaceId);
    return [...this.budgets.values()].filter(
      (budget) => budget.workspaceId === workspaceId && budget.month === month,
    );
  }

  private budgetKey(workspaceId: WorkspaceId, month: string, accountId: AccountId): string {
    return `${workspaceId}:${month}:${accountId}`;
  }

  private assertWorkspace(workspaceId: WorkspaceId): void {
    if (workspaceId !== this.workspaceId) throw new Error("WORKSPACE_MISMATCH");
  }
}
