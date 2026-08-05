import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceLayout } from "../workspace/layout";
import { createBackupService } from "./backup-service";
import { deriveWorkspaceSubkey } from "../keys/key-hierarchy";
import { openSqlCipher } from "../sqlcipher/driver";

const sourceWorkspaceId = "018f4f7e-8ead-7c0d-8000-000000000001" as never;
const targetWorkspaceId = "018f4f7e-8ead-7c0d-8000-000000000099" as never;
const slotId = "018f4f7e-8ead-7c0d-8000-000000000100" as never;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pwm-encrypted-backup-"));
  const sourceBase = join(root, "source");
  const source = await createWorkspaceLayout(sourceBase, { formatVersion: 1, workspaceId: sourceWorkspaceId, schemaVersion: 1, createdAt: "2026-08-05T00:00:00.000Z", appLock: { state: "disabled" }, recoveryState: "healthy" });
  await writeFile(source.database, Buffer.from("SQLCIPHER-SYNTHETIC-DATABASE"));
  await writeFile(join(source.objects, "018f4f7e-8ead-7c0d-8000-000000000010.pwo"), Buffer.from("encrypted-object-bytes"));
  const backupPath = join(root, "exports", "synthetic.pwb");
  const vault = { putWorkspaceSecret: async () => undefined, getWorkspaceSecret: async () => null, deleteWorkspaceSecret: async () => undefined, listWorkspaceSlots: async () => [] };
  return { root, source, backupPath, vault };
}

describe("password-encrypted workspace backup", () => {
  it("round-trips into an absent workspace without exposing the DEK in the package", async () => {
    const value = await fixture();
    const rekeyDatabase = async (path: string, fromKey: Uint8Array, toKey: Uint8Array): Promise<void> => { void path; void fromKey; void toKey; };
    const service = createBackupService({ rekeyDatabase });
    const created = await service.create({ source: value.source, sourceWorkspaceId, workspaceDek: new Uint8Array(32).fill(7), password: "backup-only passphrase", destinationPath: value.backupPath });
    expect(created.byteLength).toBeGreaterThan(0);
    const raw = await readFile(value.backupPath);
    expect(raw.includes(Buffer.from("SQLCIPHER-SYNTHETIC-DATABASE"))).toBe(false);
    await expect(service.inspect({ backupPath: value.backupPath, password: "wrong password" })).rejects.toThrow("BACKUP_PASSWORD_INVALID");
    const restored = await service.restore({ backupPath: value.backupPath, password: "backup-only passphrase", workspaceBaseDir: join(value.root, "restored"), newWorkspaceId: targetWorkspaceId, targetVault: value.vault, targetSystemSlotId: slotId });
    expect(restored.paths.root).not.toBe(value.source.root);
    expect(restored.verification).toEqual({ integrityCheck: "ok", accountCount: 0, journalCount: 0, objectCount: 1, fxQuoteCount: 0 });
    await expect(readFile(restored.paths.database, "utf8")).resolves.toBe("SQLCIPHER-SYNTHETIC-DATABASE");
  }, 30_000);

  it("rejects tampering and never overwrites an existing target", async () => {
    const value = await fixture();
    const service = createBackupService();
    await service.create({ source: value.source, sourceWorkspaceId, workspaceDek: new Uint8Array(32).fill(3), password: "backup-only passphrase", destinationPath: value.backupPath });
    const bytes = await readFile(value.backupPath);
    bytes[bytes.length - 20] = (bytes[bytes.length - 20]! ^ 0xff) & 0xff;
    await writeFile(value.backupPath, bytes);
    await expect(service.inspect({ backupPath: value.backupPath, password: "backup-only passphrase" })).rejects.toThrow("BACKUP_INTEGRITY_FAILED");
  });

  it("removes a partial target when restore verification fails", async () => {
    const value = await fixture();
    const service = createBackupService({ rekeyDatabase: async () => undefined, verifyDatabase: async () => { throw new Error("VERIFY_FAILED"); } });
    await service.create({ source: value.source, sourceWorkspaceId, workspaceDek: new Uint8Array(32).fill(9), password: "backup-only passphrase", destinationPath: value.backupPath });
    const workspaceBaseDir = join(value.root, "restore-failure");
    await expect(service.restore({ backupPath: value.backupPath, password: "backup-only passphrase", workspaceBaseDir, newWorkspaceId: targetWorkspaceId, targetVault: value.vault, targetSystemSlotId: slotId })).rejects.toThrow("VERIFY_FAILED");
    await expect(stat(join(workspaceBaseDir, targetWorkspaceId))).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);

  it("rekeys a real SQLCipher database for the restored workspace", async () => {
    const value = await fixture();
    await rm(value.source.database, { force: true });
    const sourceDek = new Uint8Array(32).fill(11);
    const sourceKey = deriveWorkspaceSubkey(sourceDek, sourceWorkspaceId, "sqlcipher-v1");
    const sourceDb = await openSqlCipher({ filePath: value.source.database, key: sourceKey, mode: "read-write" });
    await sourceDb.exec("CREATE TABLE rekey_probe (value TEXT NOT NULL)");
    await sourceDb.exec("INSERT INTO rekey_probe(value) VALUES ('synthetic-rekey')");
    await sourceDb.close();
    sourceKey.fill(0);
    let captured: string | null = null;
    const captureVault = { ...value.vault, putWorkspaceSecret: async (_workspace: never, _slot: never, secret: string) => { captured = secret; } };
    const service = createBackupService();
    await service.create({ source: value.source, sourceWorkspaceId, workspaceDek: sourceDek, password: "backup-only passphrase", destinationPath: value.backupPath });
    const restored = await service.restore({ backupPath: value.backupPath, password: "backup-only passphrase", workspaceBaseDir: join(value.root, "rekeyed"), newWorkspaceId: targetWorkspaceId, targetVault: captureVault, targetSystemSlotId: slotId });
    expect(captured).toBeTruthy();
    const targetDek = Buffer.from(captured!, "base64url");
    const targetKey = deriveWorkspaceSubkey(targetDek, targetWorkspaceId, "sqlcipher-v1");
    const targetDb = await openSqlCipher({ filePath: restored.paths.database, key: targetKey, mode: "read-only" });
    await expect(targetDb.get<{ value: string }>("SELECT value FROM rekey_probe")).resolves.toEqual({ value: "synthetic-rekey" });
    await targetDb.close();
    targetKey.fill(0);
    const oldKey = deriveWorkspaceSubkey(sourceDek, sourceWorkspaceId, "sqlcipher-v1");
    await expect(openSqlCipher({ filePath: restored.paths.database, key: oldKey, mode: "read-only" })).rejects.toThrow(/key|encrypted|not a database/i);
    oldKey.fill(0);
  }, 30_000);
});
