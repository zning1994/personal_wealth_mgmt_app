import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import type { WorkspaceDatabase } from "../database/workspace-database";

export type WorkspaceBackupManifest = {
  formatVersion: 1;
  createdAt: string;
  databaseFile: string;
  databaseSha256: string;
  byteLength: number;
};

function assertSafePath(path: string): string {
  const resolved = resolve(path);
  if (basename(resolved) !== "workspace.db") throw new Error("BACKUP_SOURCE_INVALID");
  return resolved;
}

async function hashFile(path: string): Promise<{ hash: string; byteLength: number }> {
  const bytes = await readFile(path);
  return { hash: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.byteLength };
}

export async function createWorkspaceBackup(database: WorkspaceDatabase, destinationDirectory: string): Promise<{ manifestPath: string; databasePath: string }> {
  const source = assertSafePath(database.filePath);
  await database.connection.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const sourceStat = await stat(source);
  if (!sourceStat.isFile()) throw new Error("BACKUP_SOURCE_INVALID");
  await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
  const databasePath = join(destinationDirectory, "workspace.db");
  const temporaryPath = `${databasePath}.partial`;
  await copyFile(source, temporaryPath);
  const digest = await hashFile(temporaryPath);
  await rename(temporaryPath, databasePath);
  const manifest: WorkspaceBackupManifest = { formatVersion: 1, createdAt: new Date().toISOString(), databaseFile: "workspace.db", databaseSha256: digest.hash, byteLength: digest.byteLength };
  const manifestPath = join(destinationDirectory, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { encoding: "utf8", mode: 0o600 });
  return { manifestPath, databasePath };
}

export async function verifyWorkspaceBackup(backupDirectory: string): Promise<WorkspaceBackupManifest> {
  const manifestPath = join(resolve(backupDirectory), "manifest.json");
  const databasePath = join(resolve(backupDirectory), "workspace.db");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Partial<WorkspaceBackupManifest>;
  if (manifest.formatVersion !== 1 || manifest.databaseFile !== "workspace.db" || typeof manifest.databaseSha256 !== "string" || !Number.isInteger(manifest.byteLength)) throw new Error("BACKUP_MANIFEST_INVALID");
  const digest = await hashFile(databasePath);
  if (digest.hash !== manifest.databaseSha256 || digest.byteLength !== manifest.byteLength) throw new Error("BACKUP_INTEGRITY_FAILED");
  return manifest as WorkspaceBackupManifest;
}

export async function restoreWorkspaceBackup(backupDirectory: string, targetDatabasePath: string): Promise<void> {
  await verifyWorkspaceBackup(backupDirectory);
  const target = assertSafePath(targetDatabasePath);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporaryPath = `${target}.restore-partial`;
  await copyFile(join(resolve(backupDirectory), "workspace.db"), temporaryPath);
  await rename(temporaryPath, target);
}
