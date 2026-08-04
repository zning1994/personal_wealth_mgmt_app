import type Database from "better-sqlite3-multiple-ciphers";
import { configureSqlCipher4 } from "./configure";

export interface SqlCipherOpenOptions {
  readonly filePath: string;
  readonly key: Uint8Array;
  readonly mode: "read-write" | "read-only";
}

export interface SqlCipherConnection {
  exec(sql: string): Promise<void>;
  get<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T | undefined>;
  all<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<readonly T[]>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type NativeDatabase = Database.Database;

function adaptNativeDatabase(database: NativeDatabase): SqlCipherConnection {
  let closing: Promise<void> | undefined;

  return {
    exec: async (sql) => {
      database.exec(sql);
    },
    get: async <T extends Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ) => database.prepare<unknown[], T>(sql).get(...params),
    all: async <T extends Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ) => {
      const statement = database.prepare<unknown[], T>(sql);
      if (!statement.reader) {
        if (/^\s*PRAGMA\s+cipher_integrity_check\s*;?\s*$/iu.test(sql)) {
          const rows = database.pragma("cipher_integrity_check");
          return Array.isArray(rows) ? rows as T[] : [];
        }
        throw new Error("sqlcipher-query-does-not-return-data");
      }
      return statement.all(...params);
    },
    transaction: async <T>(work: () => Promise<T>): Promise<T> => {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = await work();
        database.exec("COMMIT");
        return result;
      } catch (error: unknown) {
        try {
          database.exec("ROLLBACK");
        } catch {
          // Preserve the operation failure; caller-owned recovery handles close failures.
        }
        throw error;
      }
    },
    close: () => {
      closing ??= Promise.resolve().then(() => {
        if (database.open) database.close();
      });
      return closing;
    },
  };
}

export async function openSqlCipher(options: SqlCipherOpenOptions): Promise<SqlCipherConnection> {
  if (options.key.byteLength !== 32) {
    throw new Error("invalid-sqlcipher-key-length");
  }

  const { default: DatabaseConstructor } = await import("better-sqlite3-multiple-ciphers");
  const database = new DatabaseConstructor(options.filePath, {
    readonly: options.mode === "read-only",
    fileMustExist: options.mode === "read-only",
  });

  try {
    configureSqlCipher4(database, options.key);
    return adaptNativeDatabase(database);
  } catch (error: unknown) {
    try {
      if (database.open) database.close();
    } catch {
      // Preserve the validation error rather than replacing it with cleanup failure.
    }
    throw error;
  }
}
