import { describe, expect, it } from "vitest";
import {
  BalanceSheetQuery,
  BudgetProgressQuery,
  ChangeBaseCurrencyCommand,
  DashboardQuery,
  GoalProgressQuery,
  UpsertBudgetCommand,
  UpsertGoalCommand,
  ValuationService,
} from "../src";
import { InMemoryFinanceRepository } from "./support/in-memory-finance-repository";

const AED = "AED" as never;
const USD = "USD" as never;
const account = (suffix: string) => `00000000-0000-4000-8000-${suffix}` as never;

describe("finance projections", () => {
  it("changes only settings when switching base currency", async () => {
    const repo = new InMemoryFinanceRepository(AED);
    await new ChangeBaseCurrencyCommand(repo).execute({
      workspaceId: repo.workspaceId,
      baseCurrency: USD,
      expectedVersion: 0,
    });
    expect((await repo.getSettings(repo.workspaceId)).baseCurrency).toBe("USD");
    expect(await repo.countOriginalMoneyMutations()).toBe(0);
  });

  it("keeps missing FX explicit and preserves original money", async () => {
    const repo = new InMemoryFinanceRepository(AED);
    const fx = {
      resolve: async ({ amount }: { amount: { currency: typeof USD; minor: bigint } }) => ({
        status: "missing" as const,
        source: "none" as const,
        original: amount,
      }),
    };
    const result = await new ValuationService(repo, fx as never).value({
      workspaceId: repo.workspaceId,
      money: { currency: USD, minor: 10000n },
      onDate: "2026-08-04",
      offline: true,
      now: "2026-08-04T00:00:00Z",
    });
    expect(result).toMatchObject({ status: "missing", valued: null, original: { minor: 10000n } });
  });

  it("projects assets minus liabilities and does not roll budgets", async () => {
    const repo = new InMemoryFinanceRepository(AED);
    repo.accountBalances = [
      { accountId: account("000000000501"), name: "Cash", kind: "asset", balance: { currency: AED, minor: 100000n } },
      { accountId: account("000000000502"), name: "Card", kind: "liability", balance: { currency: AED, minor: 25000n } },
    ];
    const valuation = { value: async ({ money, onDate }: { money: { currency: never; minor: bigint }; onDate: string }) => ({ status: "fresh" as const, original: money, valued: money, quoteIds: [], asOf: onDate, provider: null }) };
    const sheet = await new BalanceSheetQuery(repo, valuation as never).execute({ workspaceId: repo.workspaceId, asOf: "2026-08-04", offline: true, now: "2026-08-04T00:00:00Z" });
    expect(sheet.netWorth?.minor).toBe(75000n);

    const category = account("000000000601");
    const budget = await new UpsertBudgetCommand(repo, () => "budget-1").execute({ workspaceId: repo.workspaceId, month: "2026-07", categoryAccountId: category, currency: AED, limitMinor: 100000n });
    await new UpsertBudgetCommand(repo, () => "budget-2").execute({ workspaceId: repo.workspaceId, month: "2026-08", categoryAccountId: category, currency: AED, limitMinor: 80000n });
    repo.categoryExpenseMinor.set(`2026-08:${category}`, 20000n);
    const progress = await new BudgetProgressQuery(repo).execute({ workspaceId: repo.workspaceId, month: budget.month === "2026-07" ? "2026-08" : "2026-07", categoryAccountId: category });
    expect(progress.rolloverMinor).toBe(0n);
  });

  it("counts only explicitly linked goal accounts", async () => {
    const repo = new InMemoryFinanceRepository(AED);
    const linked = account("000000000701");
    const goal = await new UpsertGoalCommand(repo, () => "goal-1").execute({ workspaceId: repo.workspaceId, name: "Emergency fund", target: { currency: AED, minor: 100000n }, targetDate: "2027-08-04", linkedAccountIds: [linked] });
    repo.linkedBalances.set(linked, { currency: AED, minor: 40000n });
    repo.linkedBalances.set(account("000000000702"), { currency: AED, minor: 90000n });
    const valuation = { value: async ({ money, onDate }: { money: { currency: never; minor: bigint }; onDate: string }) => ({ status: "fresh" as const, original: money, valued: money, quoteIds: [], asOf: onDate, provider: null }) };
    const progress = await new GoalProgressQuery(repo, valuation as never).execute({ goalId: goal.id, asOf: "2026-08-04", offline: true, now: "2026-08-04T00:00:00Z" });
    expect(progress).toMatchObject({ currentMinor: 40000n, targetMinor: 100000n, completionBasisPoints: 4000, status: "on-track" });
  });

  it("keeps stale FX provenance in dashboard and excludes transfers", async () => {
    const repo = new InMemoryFinanceRepository(AED);
    repo.cashFlow = { income: { currency: AED, minor: 120000n }, expense: { currency: AED, minor: 70000n } };
    const query = DashboardQuery.withFakes(repo, { netWorth: { currency: AED, minor: 500000n }, fxStatus: "stale", fxAsOf: "2026-07-01", fxProvider: "boc" });
    const result = await query.execute({ workspaceId: repo.workspaceId, month: "2026-08", asOf: "2026-08-04", offline: true, now: "2026-08-04T00:00:00Z" });
    expect(result.cashFlow.netMinor).toBe(50000n);
    expect(repo.lastCashFlowInput?.excludeTransferLinks).toBe(true);
    expect(result.fx).toEqual({ status: "stale", provider: "boc", asOf: "2026-07-01" });
  });
});
