import type { Database } from "@journeyapps/sqlcipher";

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

type SqlCipherModule = typeof import("@journeyapps/sqlcipher");

function openNativeDatabase(
  sqlite3: SqlCipherModule,
  filePath: string,
  flags: number,
): Promise<Database> {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filePath, flags, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(database);
    });
  });
}

function execNative(database: Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    database.exec(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function getNative<T extends Record<string, unknown>>(
  database: Database,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (error, row: T | undefined) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function allNative<T extends Record<string, unknown>>(
  database: Database,
  sql: string,
  params: readonly unknown[] = [],
): Promise<readonly T[]> {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows: T[]) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

function closeNative(database: Database): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function adaptNativeDatabase(database: Database): SqlCipherConnection {
  let closing: Promise<void> | undefined;

  const connection: SqlCipherConnection = {
    exec: (sql) => execNative(database, sql),
    get: <T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]) =>
      getNative<T>(database, sql, params),
    all: <T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]) =>
      allNative<T>(database, sql, params),
    transaction: async <T>(work: () => Promise<T>): Promise<T> => {
      await execNative(database, "BEGIN IMMEDIATE");
      try {
        const result = await work();
        await execNative(database, "COMMIT");
        return result;
      } catch (error: unknown) {
        try {
          await execNative(database, "ROLLBACK");
        } catch {
          // Preserve the operation failure; connection close/recovery is owned by the caller.
        }
        throw error;
      }
    },
    close: () => {
      closing ??= closeNative(database);
      return closing;
    },
  };

  return connection;
}

export async function openSqlCipher(options: SqlCipherOpenOptions): Promise<SqlCipherConnection> {
  if (options.key.byteLength !== 32) {
    throw new Error("invalid-sqlcipher-key-length");
  }

  const imported = await import("@journeyapps/sqlcipher");
  const sqlite3: SqlCipherModule =
    "Database" in imported
      ? imported
      : (imported as unknown as { readonly default: SqlCipherModule }).default;
  const flags =
    options.mode === "read-only"
      ? sqlite3.OPEN_READONLY
      : sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE;
  const database = await openNativeDatabase(sqlite3, options.filePath, flags);

  try {
    const keyHex = Buffer.from(options.key).toString("hex");
    await execNative(database, `PRAGMA key = "x'${keyHex}'"`);
    await execNative(database, "PRAGMA cipher_memory_security = ON");
    await execNative(database, "PRAGMA foreign_keys = ON");
    await getNative(database, "SELECT count(*) AS count FROM sqlite_master");
    return adaptNativeDatabase(database);
  } catch (error: unknown) {
    try {
      await closeNative(database);
    } catch {
      // The validation error is the useful failure and must not be replaced by cleanup failure.
    }
    throw error;
  }
}
