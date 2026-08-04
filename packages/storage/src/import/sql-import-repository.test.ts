import { describe, expect, it } from "vitest";
import { createSqlImportRepository, initializeImportSchema } from "./sql-import-repository";

describe("SQL import repository", () => {
  it("initializes the idempotency and raw-record link tables", async () => { const statements: string[] = []; const connection = { exec: async (sql: string) => { statements.push(sql); }, get: async () => undefined, all: async () => [], transaction: async <T>(work: () => Promise<T>) => work(), close: async () => undefined }; await initializeImportSchema(connection); expect(statements[0]).toContain("import_commit"); expect(createSqlImportRepository(connection)).toHaveProperty("findCommit"); });
});
