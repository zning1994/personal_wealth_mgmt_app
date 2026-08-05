import type {
  AccountId,
  Currency,
  WorkspaceId,
} from "@pwm/contracts";
import type {
  AccountBalance,
  CashFlowTotals,
  FinanceRepository,
  FinancialGoal,
  WorkspaceFinanceSettings,
} from "@pwm/application";
import type { AccountKind } from "@pwm/domain";
import type { SqlCipherConnection } from "../sqlcipher/driver";

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const currency = (value: unknown): Currency => String(value) as Currency;
const workspace = (value: unknown): WorkspaceId => String(value) as WorkspaceId;
const account = (value: unknown): AccountId => String(value) as AccountId;
const monthBounds = (month: string): readonly [string, string] => {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (match === null) throw new Error("INVALID_MONTH");
  const year = Number(match[1]);
  const next = Number(match[2]) === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(Number(match[2]) + 1).padStart(2, "0")}-01`;
  return [`${month}-01`, next];
};

type FinanceRow = Record<string, unknown>;

export function createSqlFinanceRepository(
  connection: SqlCipherConnection,
  options: { readonly defaultBaseCurrency?: Currency; readonly defaultStaleAfterDays?: number } = {},
): FinanceRepository {
  const defaultBaseCurrency = options.defaultBaseCurrency ?? ("AED" as Currency);
  const defaultStaleAfterDays = options.defaultStaleAfterDays ?? 7;

  const getSettings = async (workspaceId: WorkspaceId): Promise<WorkspaceFinanceSettings> => {
    const row = await connection.get<FinanceRow>(
      "SELECT workspace_id, base_currency, stale_after_days, auto_fx_enabled, version FROM finance_settings WHERE workspace_id = ?",
      [workspaceId],
    );
    if (row === undefined) {
      await connection.exec(
        `INSERT INTO finance_settings (workspace_id, base_currency, stale_after_days, auto_fx_enabled, version) VALUES (${quote(workspaceId)}, ${quote(defaultBaseCurrency)}, ${defaultStaleAfterDays}, 1, 0)`,
      );
      return {
        workspaceId,
        baseCurrency: defaultBaseCurrency,
        staleAfterDays: defaultStaleAfterDays,
        autoFxEnabled: true,
        version: 0,
      };
    }
    return {
      workspaceId: workspace(row.workspace_id),
      baseCurrency: currency(row.base_currency),
      staleAfterDays: Number(row.stale_after_days),
      autoFxEnabled: Number(row.auto_fx_enabled) === 1,
      version: Number(row.version),
    };
  };

  const listAccountBalances = async (input: {
    readonly workspaceId: WorkspaceId;
    readonly asOf: string;
    readonly kinds: readonly AccountKind[];
  }): Promise<readonly AccountBalance[]> => {
    if (input.kinds.length === 0) return [];
    const placeholders = input.kinds.map(() => "?").join(", ");
    const rows = await connection.all<FinanceRow>(
      `SELECT a.id AS account_id, a.name, a.kind, a.currency, p.amount_minor
       FROM account a
       LEFT JOIN posting p ON p.account_id = a.id
       LEFT JOIN journal_entry j ON j.id = p.journal_id
       WHERE a.workspace_id = ? AND a.deleted_at IS NULL
         AND a.kind IN (${placeholders})
         AND (p.id IS NULL OR (j.workspace_id = ? AND j.deleted_at IS NULL AND j.occurred_on <= ?))
       ORDER BY a.name, a.id`,
      [input.workspaceId, ...input.kinds, input.workspaceId, input.asOf],
    );
    const byId = new Map<string, AccountBalance>();
    for (const row of rows) {
      const id = String(row.account_id);
      const current = byId.get(id);
      const amount = row.amount_minor === undefined || row.amount_minor === null
        ? 0n
        : BigInt(String(row.amount_minor));
      if (current === undefined) {
        byId.set(id, {
          accountId: account(row.account_id),
          name: String(row.name),
          kind: String(row.kind) as AccountKind,
          balance: { currency: currency(row.currency), minor: amount },
        });
      } else {
        byId.set(id, {
          ...current,
          balance: { ...current.balance, minor: current.balance.minor + amount },
        });
      }
    }
    return [...byId.values()];
  };

  const sumExpenseOrIncome = async (input: {
    readonly workspaceId: WorkspaceId;
    readonly month: string;
    readonly currency: Currency;
    readonly kind?: "income" | "expense";
    readonly categoryAccountId?: AccountId;
    readonly excludeTransferLinks?: true;
  }): Promise<bigint> => {
    const [from, to] = monthBounds(input.month);
    const clauses = ["a.workspace_id = ?", "a.currency = ?", "j.workspace_id = ?", "j.deleted_at IS NULL", "j.occurred_on >= ?", "j.occurred_on < ?"];
    const params: unknown[] = [input.workspaceId, input.currency, input.workspaceId, from, to];
    if (input.kind !== undefined) {
      clauses.push("a.kind = ?");
      params.push(input.kind);
    }
    if (input.categoryAccountId !== undefined) {
      clauses.push("a.id = ?");
      params.push(input.categoryAccountId);
    }
    if (input.excludeTransferLinks === true) clauses.push("j.transfer_link_id IS NULL");
    const rows = await connection.all<FinanceRow>(
      `SELECT p.amount_minor FROM posting p JOIN journal_entry j ON j.id = p.journal_id JOIN account a ON a.id = p.account_id WHERE ${clauses.join(" AND ")}`,
      params,
    );
    return rows.reduce((sum, row) => {
      const amount = BigInt(String(row.amount_minor));
      return sum + (amount < 0n ? -amount : amount);
    }, 0n);
  };

  return {
    getSettings,
    async updateBaseCurrency(workspaceId, baseCurrency, expectedVersion) {
      const current = await getSettings(workspaceId);
      if (current.version !== expectedVersion) throw new Error("VERSION_CONFLICT");
      await connection.exec(
        `UPDATE finance_settings SET base_currency = ${quote(baseCurrency)}, version = ${expectedVersion + 1} WHERE workspace_id = ${quote(workspaceId)} AND version = ${expectedVersion}`,
      );
    },
    async countOriginalMoneyMutations() {
      // Finance projections are read-only.  This counter is intentionally
      // separate from activity history, which records user operations.
      return 0;
    },
    listAccountBalances,
    async saveBudget(budget, expectedVersion) {
      const existing = await connection.get<FinanceRow>(
        "SELECT version FROM budget WHERE workspace_id = ? AND month = ? AND category_account_id = ? AND deleted_at IS NULL",
        [budget.workspaceId, budget.month, budget.categoryAccountId],
      );
      if ((existing === undefined ? null : Number(existing.version)) !== expectedVersion) throw new Error("VERSION_CONFLICT");
      const deleted = "NULL";
      if (existing === undefined) {
        await connection.exec(
          `INSERT INTO budget (id, workspace_id, month, category_account_id, currency, limit_minor, version, deleted_at) VALUES (${quote(budget.id)}, ${quote(budget.workspaceId)}, ${quote(budget.month)}, ${quote(budget.categoryAccountId)}, ${quote(budget.currency)}, ${quote(budget.limitMinor.toString())}, ${budget.version}, ${deleted})`,
        );
      } else {
        await connection.exec(
          `UPDATE budget SET id = ${quote(budget.id)}, currency = ${quote(budget.currency)}, limit_minor = ${quote(budget.limitMinor.toString())}, version = ${budget.version}, deleted_at = ${deleted} WHERE workspace_id = ${quote(budget.workspaceId)} AND month = ${quote(budget.month)} AND category_account_id = ${quote(budget.categoryAccountId)} AND version = ${Number(existing.version)}`,
        );
      }
    },
    async findBudget(workspaceId, month, categoryAccountId) {
      const row = await connection.get<FinanceRow>(
        "SELECT id, workspace_id, month, category_account_id, currency, limit_minor, version FROM budget WHERE workspace_id = ? AND month = ? AND category_account_id = ? AND deleted_at IS NULL",
        [workspaceId, month, categoryAccountId],
      );
      if (row === undefined) return null;
      return {
        id: String(row.id), workspaceId: workspace(row.workspace_id), month: String(row.month),
        categoryAccountId: account(row.category_account_id), currency: currency(row.currency),
        limitMinor: BigInt(String(row.limit_minor)), version: Number(row.version),
      };
    },
    async sumCategoryExpense(input) {
      return { currency: input.currency, minor: await sumExpenseOrIncome({ ...input, kind: "expense" }) };
    },
    async saveGoal(goal, expectedVersion) {
      await connection.transaction(async () => {
        const existing = await connection.get<FinanceRow>("SELECT version FROM financial_goal WHERE id = ? AND deleted_at IS NULL", [goal.id]);
        if ((existing === undefined ? null : Number(existing.version)) !== expectedVersion) throw new Error("VERSION_CONFLICT");
        const values = `${quote(goal.id)}, ${quote(goal.workspaceId)}, ${quote(goal.name)}, ${quote(goal.target.currency)}, ${quote(goal.target.minor.toString())}, ${quote(goal.targetDate)}, ${goal.version}, NULL`;
        if (existing === undefined) await connection.exec(`INSERT INTO financial_goal (id, workspace_id, name, target_currency, target_minor, target_date, version, deleted_at) VALUES (${values})`);
        else await connection.exec(`UPDATE financial_goal SET name = ${quote(goal.name)}, target_currency = ${quote(goal.target.currency)}, target_minor = ${quote(goal.target.minor.toString())}, target_date = ${quote(goal.targetDate)}, version = ${goal.version}, deleted_at = NULL WHERE id = ${quote(goal.id)} AND version = ${Number(existing.version)}`);
        await connection.exec(`DELETE FROM goal_account WHERE goal_id = ${quote(goal.id)}`);
        for (const [ordinal, accountId] of goal.linkedAccountIds.entries()) await connection.exec(`INSERT INTO goal_account (goal_id, account_id, ordinal) VALUES (${quote(goal.id)}, ${quote(accountId)}, ${ordinal})`);
      });
    },
    async findGoal(id) {
      const row = await connection.get<FinanceRow>("SELECT id, workspace_id, name, target_currency, target_minor, target_date, version FROM financial_goal WHERE id = ? AND deleted_at IS NULL", [id]);
      if (row === undefined) return null;
      const linked = await connection.all<FinanceRow>("SELECT account_id FROM goal_account WHERE goal_id = ? ORDER BY ordinal", [id]);
      return {
        id: String(row.id), workspaceId: workspace(row.workspace_id), name: String(row.name),
        target: { currency: currency(row.target_currency), minor: BigInt(String(row.target_minor)) },
        targetDate: String(row.target_date), linkedAccountIds: linked.map((item) => account(item.account_id)), version: Number(row.version),
      };
    },
    async listGoals(workspaceId) {
      const rows = await connection.all<FinanceRow>("SELECT id FROM financial_goal WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY target_date, id", [workspaceId]);
      const goals: FinancialGoal[] = [];
      for (const row of rows) {
        const goal = await this.findGoal(String(row.id));
        if (goal !== null) goals.push(goal);
      }
      return goals;
    },
    async listBalancesForAccounts(workspaceId, accountIds, asOf) {
      if (accountIds.length === 0) return [];
      const rows = await listAccountBalances({ workspaceId, asOf, kinds: ["asset", "liability", "income", "expense", "equity"] });
      const wanted = new Set(accountIds);
      return rows.filter((row) => wanted.has(row.accountId)).map((row) => row.balance);
    },
    async sumCashFlow(input) {
      const [income, expense] = await Promise.all([
        sumExpenseOrIncome({ ...input, kind: "income", excludeTransferLinks: input.excludeTransferLinks }),
        sumExpenseOrIncome({ ...input, kind: "expense", excludeTransferLinks: input.excludeTransferLinks }),
      ]);
      return { income: { currency: input.currency, minor: income }, expense: { currency: input.currency, minor: expense } } satisfies CashFlowTotals;
    },
    async listBudgets(workspaceId, month) {
      const rows = await connection.all<FinanceRow>("SELECT id, workspace_id, month, category_account_id, currency, limit_minor, version FROM budget WHERE workspace_id = ? AND month = ? AND deleted_at IS NULL ORDER BY category_account_id, id", [workspaceId, month]);
      return rows.map((row) => ({ id: String(row.id), workspaceId: workspace(row.workspace_id), month: String(row.month), categoryAccountId: account(row.category_account_id), currency: currency(row.currency), limitMinor: BigInt(String(row.limit_minor)), version: Number(row.version) }));
    },
  };
}
