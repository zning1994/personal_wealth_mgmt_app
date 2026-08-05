import { describe, expect, it } from "vitest";
import type { SqlCipherConnection } from "../sqlcipher/driver";
import { createSqlLedgerRepository } from "./sql-ledger-repository";

describe("SQL ledger repository", () => {
  it("uses idempotency and optimistic replacement through one connection", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const connection: SqlCipherConnection = {
      exec: async (sql) => { void sql; },
      get: async <T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) => { void params; if (sql.includes("journal_idempotency")) return undefined; if (sql.includes("SELECT version")) return { version: 0 } as unknown as T; return undefined; },
      all: async <T extends Record<string, unknown>>() => [] as T[],
      transaction: async <T>(work: () => Promise<T>) => work(),
      close: async () => undefined,
    };
    const repo = createSqlLedgerRepository(connection);
    await expect(repo.findJournalByIdempotencyKey("00000000-0000-4000-8000-000000000001" as never, "synthetic")).resolves.toBeNull();
    await expect(repo.replaceJournal({ id: "00000000-0000-4000-8000-000000000002" as never, workspaceId: "00000000-0000-4000-8000-000000000001" as never, occurredOn: "2026-08-05", description: "Synthetic", postings: [], version: 1, deletedAt: null, transferLinkId: null }, 0)).resolves.toBeUndefined();
    expect(rows.size).toBe(0);
  });
});
