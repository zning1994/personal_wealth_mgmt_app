import type { SqlCipherConnection } from "../sqlcipher/driver";

export async function initializeLedgerSchema(connection: SqlCipherConnection): Promise<void> {
  await connection.exec(`
    CREATE TABLE IF NOT EXISTS profile (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, display_name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('asset', 'liability', 'income', 'expense', 'equity')),
      currency TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS account_ownership (
      workspace_id TEXT NOT NULL, account_id TEXT NOT NULL, profile_id TEXT NOT NULL,
      basis_points INTEGER NOT NULL CHECK (basis_points > 0 AND basis_points <= 10000),
      PRIMARY KEY (account_id, profile_id)
    );
    CREATE TABLE IF NOT EXISTS journal_idempotency (
      workspace_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, journal_id TEXT NOT NULL,
      PRIMARY KEY (workspace_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS finance_settings (
      workspace_id TEXT PRIMARY KEY,
      base_currency TEXT NOT NULL,
      stale_after_days INTEGER NOT NULL CHECK (stale_after_days >= 0),
      auto_fx_enabled INTEGER NOT NULL CHECK (auto_fx_enabled IN (0, 1)),
      version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS fx_quote (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, provider TEXT NOT NULL,
      foreign_currency TEXT NOT NULL, to_currency TEXT NOT NULL,
      cny_per_100 TEXT NOT NULL, field TEXT NOT NULL,
      as_of TEXT NOT NULL, published_at_utc TEXT NOT NULL, fetched_at TEXT NOT NULL,
      etag TEXT, payload_hash TEXT NOT NULL, numerator TEXT NOT NULL, denominator TEXT NOT NULL,
      UNIQUE (workspace_id, foreign_currency, to_currency, as_of, field)
    );
    CREATE TABLE IF NOT EXISTS fx_override (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL, numerator TEXT NOT NULL, denominator TEXT NOT NULL,
      as_of TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL DEFAULT 0,
      UNIQUE (workspace_id, from_currency, to_currency, as_of)
    );
    CREATE TABLE IF NOT EXISTS budget (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, month TEXT NOT NULL,
      category_account_id TEXT NOT NULL, currency TEXT NOT NULL, limit_minor TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0, deleted_at TEXT,
      UNIQUE (workspace_id, month, category_account_id)
    );
    CREATE TABLE IF NOT EXISTS financial_goal (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      target_currency TEXT NOT NULL, target_minor TEXT NOT NULL, target_date TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS goal_account (
      goal_id TEXT NOT NULL REFERENCES financial_goal(id), account_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL, PRIMARY KEY (goal_id, account_id)
    );
    CREATE INDEX IF NOT EXISTS idx_journal_entry_workspace_date ON journal_entry(workspace_id, occurred_on);
    CREATE INDEX IF NOT EXISTS idx_posting_journal ON posting(journal_id);
    CREATE INDEX IF NOT EXISTS idx_fx_quote_lookup ON fx_quote(workspace_id, foreign_currency, to_currency, as_of);
    CREATE INDEX IF NOT EXISTS idx_fx_override_lookup ON fx_override(workspace_id, from_currency, to_currency, as_of);
    CREATE INDEX IF NOT EXISTS idx_budget_lookup ON budget(workspace_id, month, category_account_id);
    CREATE INDEX IF NOT EXISTS idx_goal_workspace ON financial_goal(workspace_id, deleted_at);
  `);
  const columns = await connection.all<{ name: string }>("PRAGMA table_info(account)");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("created_at")) await connection.exec("ALTER TABLE account ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
  if (!names.has("updated_at")) await connection.exec("ALTER TABLE account ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
}
