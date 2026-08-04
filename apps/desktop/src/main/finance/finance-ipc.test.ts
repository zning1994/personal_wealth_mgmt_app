import { describe, expect, it, vi } from "vitest";
import { registerFinanceIpc } from "./finance-ipc";

describe("registerFinanceIpc", () => {
  it("validates overview and mutation payloads at the IPC boundary", async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    const service = {
      overview: vi.fn(async () => ({ asOf: "2026-08-05", month: "2026-08", baseCurrency: "AED", netWorthMinor: null, incomeMinor: "0", expenseMinor: "0", cashFlowMinor: "0", fxStatus: "missing", fxProvider: null, fxAsOf: null, budgetCount: 0, goalCount: 0 })),
      listBudgets: vi.fn(async () => []), listGoals: vi.fn(async () => []),
      upsertBudget: vi.fn(async (value) => ({ id: "00000000-0000-4000-8000-000000000001", month: value.month, categoryAccountId: value.categoryAccountId, currency: value.currency, limitMinor: value.limitMinor, spentMinor: "0", remainingMinor: value.limitMinor, rolloverMinor: "0" })),
      upsertGoal: vi.fn(async () => ({ id: "00000000-0000-4000-8000-000000000002", name: "Emergency", targetCurrency: "AED", targetMinor: "100", targetDate: "2027-01-01", currentMinor: "0", completionBasisPoints: 0, status: "on-track" })),
      getSettings: vi.fn(async () => ({ workspaceId: "00000000-0000-4000-8000-000000000003", baseCurrency: "AED", staleAfterDays: 7, autoFxEnabled: true, version: 0 })),
      setBaseCurrency: vi.fn(async () => ({ workspaceId: "00000000-0000-4000-8000-000000000003", baseCurrency: "USD", staleAfterDays: 7, autoFxEnabled: true, version: 1 })),
    };
    const unregister = registerFinanceIpc({ handle: (channel, handler) => handlers.set(channel, handler), removeHandler: vi.fn() }, service as never);
    await expect(handlers.get("finance:overview")?.({}, { month: "2026-08" })).resolves.toMatchObject({ baseCurrency: "AED" });
    await expect(handlers.get("finance:overview")?.({}, { month: "bad" })).rejects.toThrow();
    await expect(handlers.get("finance:set-base-currency")?.({}, { baseCurrency: "USD", expectedVersion: 0 })).resolves.toMatchObject({ baseCurrency: "USD" });
    unregister();
  });
});
