import type { AccountId, Currency, WorkspaceId } from "@pwm/contracts";
import type { FinanceRepository, MonthlyBudget } from "../ports/finance-repository";

export type { MonthlyBudget } from "../ports/finance-repository";

export interface BudgetProgress {
  readonly limitMinor: bigint;
  readonly spentMinor: bigint;
  readonly remainingMinor: bigint;
  readonly rolloverMinor: 0n;
}

const validMonth = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match !== null && Number(match[2]) >= 1 && Number(match[2]) <= 12;
};

export class UpsertBudgetCommand {
  constructor(
    private readonly repository: FinanceRepository,
    private readonly createId: () => string,
  ) {}

  async execute(input: {
    readonly workspaceId: WorkspaceId;
    readonly month: string;
    readonly categoryAccountId: AccountId;
    readonly currency: Currency;
    readonly limitMinor: bigint;
  }): Promise<MonthlyBudget> {
    if (!validMonth(input.month) || input.limitMinor < 0n) {
      throw new Error("INVALID_MONTHLY_BUDGET");
    }
    const existing = await this.repository.findBudget(
      input.workspaceId,
      input.month,
      input.categoryAccountId,
    );
    const budget: MonthlyBudget = {
      ...input,
      id: existing?.id ?? this.createId(),
      version: (existing?.version ?? -1) + 1,
    };
    await this.repository.saveBudget(budget, existing?.version ?? null);
    return budget;
  }
}

export class BudgetProgressQuery {
  constructor(private readonly repository: FinanceRepository) {}

  async execute(input: {
    readonly workspaceId: WorkspaceId;
    readonly month: string;
    readonly categoryAccountId: AccountId;
  }): Promise<BudgetProgress> {
    if (!validMonth(input.month)) throw new Error("INVALID_MONTH");
    const budget = await this.repository.findBudget(
      input.workspaceId,
      input.month,
      input.categoryAccountId,
    );
    if (budget === null) throw new Error("BUDGET_NOT_FOUND");
    const spent = await this.repository.sumCategoryExpense({
      ...input,
      currency: budget.currency,
    });
    return {
      limitMinor: budget.limitMinor,
      spentMinor: spent.minor,
      remainingMinor: budget.limitMinor - spent.minor,
      rolloverMinor: 0n,
    };
  }
}
