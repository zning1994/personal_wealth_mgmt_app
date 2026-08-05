import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openWorkspaceDatabase } from "../database/workspace-database";
import { createSqlAccountRepository } from "./sql-account-repository";
import { createSqlFinanceRepository } from "./sql-finance-repository";
import { createSqlFxRateStore } from "./sql-fx-rate-store";
import { createSqlLedgerRepository } from "./sql-ledger-repository";

const workspace = "00000000-0000-4000-8000-000000000001" as never;
const account = (suffix: string) => `00000000-0000-4000-8000-${suffix}` as never;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SQL finance projections", () => {
  it("persists settings, journals, budgets, goals and FX cache/overrides", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pwm-finance-"));
    roots.push(root);
    const database = await openWorkspaceDatabase({ filePath: path.join(root, "workspace.db"), key: randomBytes(32) });
    let nextAccount = 100;
    const accounts = createSqlAccountRepository(database.connection, { account: () => account(String(++nextAccount).padStart(12, "0")) });
    const cash = await accounts.create({ workspaceId: workspace, name: "Cash", kind: "asset", currency: "AED" as never });
    const expense = await accounts.create({ workspaceId: workspace, name: "Food", kind: "expense", currency: "AED" as never });
    const ledger = createSqlLedgerRepository(database.connection);
    await ledger.saveJournal({
      id: account("000000000201"), workspaceId: workspace, occurredOn: "2026-08-04", description: "Lunch", version: 0, deletedAt: null, transferLinkId: null,
      postings: [
        { id: account("000000000301"), accountId: cash.id, amount: { currency: "AED" as never, minor: -2500n }, role: "principal" },
        { id: account("000000000302"), accountId: expense.id, amount: { currency: "AED" as never, minor: 2500n }, role: "category" },
      ],
    }, "synthetic-lunch");

    const finance = createSqlFinanceRepository(database.connection);
    expect((await finance.getSettings(workspace)).baseCurrency).toBe("AED");
    const balances = await finance.listAccountBalances({ workspaceId: workspace, asOf: "2026-08-05", kinds: ["expense"] });
    expect(balances).toMatchObject([{ accountId: expense.id, balance: { minor: 2500n } }]);

    const budget = { id: account("000000000401"), workspaceId: workspace, month: "2026-08", categoryAccountId: expense.id, currency: "AED" as never, limitMinor: 10000n, version: 0 };
    await finance.saveBudget(budget, null);
    expect(await finance.sumCategoryExpense({ workspaceId: workspace, month: "2026-08", categoryAccountId: expense.id, currency: "AED" as never })).toEqual({ currency: "AED", minor: 2500n });

    const goal = { id: account("000000000501"), workspaceId: workspace, name: "Cash goal", target: { currency: "AED" as never, minor: 100000n }, targetDate: "2027-01-01", linkedAccountIds: [cash.id], version: 0 };
    await finance.saveGoal(goal, null);
    expect((await finance.findGoal(goal.id))?.linkedAccountIds).toEqual([cash.id]);

    const fx = createSqlFxRateStore(database.connection, workspace);
    await fx.putCached({ provider: "boc", field: "conversion", fetchedAt: "2026-08-05T00:00:00Z", etag: "v1", payloadHash: "sha256:cache", rate: { from: "USD" as never, to: "AED" as never, numerator: 367n, denominator: 100n, quoteIds: [account("000000000601")], asOf: "2026-08-04" } });
    expect((await fx.findCached({ workspaceId: workspace, from: "USD" as never, to: "AED" as never, onDate: "2026-08-04" }))?.rate.numerator).toBe(367n);
    const override = { id: account("000000000701"), workspaceId: workspace, rate: { from: "USD" as never, to: "AED" as never, numerator: 400n, denominator: 100n, quoteIds: [], asOf: "2026-08-04" }, deletedAt: null, version: 0 };
    await fx.saveManualOverride(override, null);
    expect((await fx.findManualOverride({ workspaceId: workspace, from: "USD" as never, to: "AED" as never, asOf: "2026-08-04" }))?.rate.numerator).toBe(400n);
    await fx.deleteManualOverride({ workspaceId: workspace, id: override.id, deletedAt: "2026-08-05T00:00:00Z" }, 0);
    expect((await fx.findManual({ workspaceId: workspace, from: "USD" as never, to: "AED" as never, onDate: "2026-08-04" }))?.deletedAt).not.toBeNull();
    await database.close();
  });
});
