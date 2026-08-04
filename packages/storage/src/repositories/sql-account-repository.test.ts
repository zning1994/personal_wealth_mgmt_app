import { describe, expect, it } from "vitest";
import type { SqlCipherConnection } from "../sqlcipher/driver";
import { createSqlAccountRepository } from "./sql-account-repository";

describe("SQL account repository", () => {
  it("creates an account with a serializable version and timestamps", async () => {
    const statements: string[] = [];
    const connection: SqlCipherConnection = { exec: async (sql) => { statements.push(sql); }, get: async () => undefined, all: async () => [], transaction: async (work) => work(), close: async () => undefined };
    const repo = createSqlAccountRepository(connection, { account: () => "00000000-0000-4000-8000-000000000101" as never });
    const account = await repo.create({ workspaceId: "00000000-0000-4000-8000-000000000001" as never, name: " Cash ", kind: "asset", currency: "AED" as never });
    expect(account.name).toBe("Cash");
    expect(statements[0]).toContain("INSERT INTO account");
  });
});
