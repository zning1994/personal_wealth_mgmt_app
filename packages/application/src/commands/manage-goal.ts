import { IsoDateSchema } from "@pwm/contracts";
import type { Money } from "@pwm/domain";
import type { FinanceRepository, FinancialGoal } from "../ports/finance-repository";
import type { ValuationService } from "../queries/valuation";

export type { FinancialGoal } from "../ports/finance-repository";

export interface GoalProgress {
  readonly currentMinor: bigint;
  readonly targetMinor: bigint;
  readonly completionBasisPoints: number;
  readonly status: "on-track" | "complete" | "missing-fx";
}

export class UpsertGoalCommand {
  constructor(
    private readonly repository: FinanceRepository,
    private readonly createId: () => string,
  ) {}

  async execute(
    input: Omit<FinancialGoal, "id" | "version"> & { readonly id?: string },
  ): Promise<FinancialGoal> {
    const name = input.name.trim();
    if (
      name.length === 0 ||
      !IsoDateSchema.safeParse(input.targetDate).success ||
      input.target.minor <= 0n ||
      input.linkedAccountIds.length === 0 ||
      new Set(input.linkedAccountIds).size !== input.linkedAccountIds.length
    ) {
      throw new Error("INVALID_FINANCIAL_GOAL");
    }
    const existing = input.id
      ? await this.repository.findGoal(input.id)
      : null;
    if (input.id !== undefined && existing === null) {
      throw new Error("GOAL_NOT_FOUND");
    }
    const goal: FinancialGoal = {
      ...input,
      name,
      id: existing?.id ?? this.createId(),
      version: (existing?.version ?? -1) + 1,
    };
    await this.repository.saveGoal(goal, existing?.version ?? null);
    return goal;
  }
}

export class GoalProgressQuery {
  constructor(
    private readonly repository: FinanceRepository,
    private readonly valuation: Pick<ValuationService, "value">,
  ) {}

  async execute(input: {
    readonly goalId: string;
    readonly asOf: string;
    readonly offline: boolean;
    readonly now: string;
  }): Promise<GoalProgress> {
    const goal = await this.repository.findGoal(input.goalId);
    if (goal === null) throw new Error("GOAL_NOT_FOUND");
    const balances = await this.repository.listBalancesForAccounts(
      goal.workspaceId,
      goal.linkedAccountIds,
      input.asOf,
    );
    const valued = await Promise.all(
      balances.map((money) =>
        this.valuation.value({
          workspaceId: goal.workspaceId,
          money,
          onDate: input.asOf,
          offline: input.offline,
          now: input.now,
        }),
      ),
    );
    if (
      valued.some(
        (row) => row.valued === null || row.valued.currency !== goal.target.currency,
      )
    ) {
      return {
        currentMinor: 0n,
        targetMinor: goal.target.minor,
        completionBasisPoints: 0,
        status: "missing-fx",
      };
    }
    const currentMinor = valued.reduce(
      (sum, row) => sum + (row.valued as Money).minor,
      0n,
    );
    const rawBasisPoints = Number(
      (currentMinor * 10000n) / goal.target.minor,
    );
    return {
      currentMinor,
      targetMinor: goal.target.minor,
      completionBasisPoints: Math.min(10000, Math.max(0, rawBasisPoints)),
      status: currentMinor >= goal.target.minor ? "complete" : "on-track",
    };
  }
}
