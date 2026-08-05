import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup, verifyWorkspaceBackup } from "./workspace-backup";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("workspace backup", () => {
  it("creates, verifies, and restores an encrypted database file without exporting the key", async () => {
    const root = await mkdtemp(join(tmpdir(), "pwm-backup-")); roots.push(root);
    const source = join(root, "workspace.db"); const backup = join(root, "backup"); const target = join(root, "restore", "workspace.db");
    await writeFile(source, Buffer.from("ciphertext-only"));
    let checkpoints = 0;
    const database = { filePath: source, connection: { exec: async () => { checkpoints += 1; } } } as never;
    const created = await createWorkspaceBackup(database, backup);
    expect(checkpoints).toBe(1);
    await expect(verifyWorkspaceBackup(backup)).resolves.toMatchObject({ formatVersion: 1 });
    await restoreWorkspaceBackup(backup, target);
    await expect(readFile(target, "utf8")).resolves.toBe("ciphertext-only");
    expect(created.manifestPath).toContain("manifest.json");
  });

  it("rejects a tampered backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "pwm-backup-")); roots.push(root);
    const source = join(root, "workspace.db"); const backup = join(root, "backup");
    await writeFile(source, Buffer.from("ciphertext-only"));
    await createWorkspaceBackup({ filePath: source, connection: { exec: async () => undefined } } as never, backup);
    await writeFile(join(backup, "workspace.db"), Buffer.from("tampered"));
    await expect(verifyWorkspaceBackup(backup)).rejects.toThrow("BACKUP_INTEGRITY_FAILED");
  });
});
