import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { StorageErrorCode } from "@pwm/contracts";
import { StorageError } from "@pwm/contracts";
import type { SqlCipherConnection } from "../sqlcipher/driver";
import type { WorkspacePaths } from "../workspace/layout";

export interface Migration { readonly version: number; readonly name: string; up(connection: SqlCipherConnection): Promise<void>; verify(connection: SqlCipherConnection): Promise<void> }

function migrationError(code: StorageErrorCode, cause: unknown): StorageError {
  return new StorageError(code, cause);
}

function assertContiguous(currentVersion: number, migrations: readonly Migration[]): void {
  const versions = migrations.map((migration) => migration.version);
  if (new Set(versions).size !== versions.length || versions.some((version, index) => version !== currentVersion + index + 1)) throw new StorageError("migration-failed");
}

export async function createEncryptedCheckpoint(connection: SqlCipherConnection, paths: WorkspacePaths): Promise<string> {
  await mkdir(paths.checkpoints, { recursive: true, mode: 0o700 });
  await connection.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const checkpoint = join(paths.checkpoints, `${randomUUID()}.pwc`);
  await copyFile(paths.database, checkpoint);
  return checkpoint;
}

export async function runMigrations(input: { connection: SqlCipherConnection; paths: WorkspacePaths; currentVersion: number; migrations: readonly Migration[] }): Promise<number> {
  assertContiguous(input.currentVersion, input.migrations);
  if (input.migrations.length === 0) return input.currentVersion;
  await createEncryptedCheckpoint(input.connection, input.paths);
  let version = input.currentVersion;
  for (const migration of input.migrations) {
    try {
      await input.connection.transaction(async () => {
        await migration.up(input.connection);
        await migration.verify(input.connection);
        await input.connection.exec(`PRAGMA user_version = ${migration.version}`);
      });
      version = migration.version;
    } catch (error: unknown) {
      throw migrationError("migration-failed", error);
    }
  }
  return version;
}

export async function latestCheckpoint(paths: WorkspacePaths): Promise<string | null> {
  const entries = await readdir(paths.checkpoints).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; });
  const candidates = entries.filter((entry) => entry.endsWith(".pwc")).sort();
  return candidates.at(-1) ? join(paths.checkpoints, candidates.at(-1)!) : null;
}

export async function checkpointAvailable(paths: WorkspacePaths): Promise<boolean> {
  const checkpoint = await latestCheckpoint(paths);
  if (!checkpoint) return false;
  try { return (await stat(checkpoint)).isFile(); } catch { return false; }
}
