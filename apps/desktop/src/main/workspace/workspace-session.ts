import type { WorkspaceApi, WorkspaceStatus } from "@pwm/contracts";
import { app, dialog, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { writeFile, chmod } from "node:fs/promises";
import { createBackupService, openSqlCipher } from "@pwm/storage";
import type { LocalImportComposition, LocalImportControllerOptions } from "../import/in-memory-import-controller";
import { createLocalImportController } from "../import/in-memory-import-controller";
import { disableLocalWorkspaceAppLock, enableLocalWorkspaceAppLock, inspectLocalWorkspace } from "./local-workspace";

export class LocalWorkspaceSession implements WorkspaceApi {
  private composition: LocalImportComposition | undefined;
  private statusValue: WorkspaceStatus = { state: "new" };

  constructor(private readonly options: LocalImportControllerOptions = {}, private readonly onReady?: (composition: LocalImportComposition) => Promise<void> | void) {}

  get current(): LocalImportComposition | undefined { return this.composition; }

  async initialize(): Promise<WorkspaceStatus> {
    try {
      this.composition = await createLocalImportController(this.options);
      this.statusValue = { state: "ready", workspaceId: await this.composition.controller.getWorkspaceId() };
      await this.onReady?.(this.composition);
    } catch (error: unknown) {
      if (!(error instanceof Error) || !["WORKSPACE_APP_LOCK_REQUIRED", "WORKSPACE_PASSWORD_INVALID", "WORKSPACE_APP_LOCK_PENDING", "WORKSPACE_KEY_MISSING"].includes(error.message)) throw error;
      const status = await inspectLocalWorkspace();
      this.statusValue = { state: status.state, ...(status.workspaceId === undefined ? {} : { workspaceId: status.workspaceId as never }) };
    }
    return this.statusValue;
  }

  async status(): Promise<WorkspaceStatus> { return this.statusValue; }

  async unlock(input: { password: string }): Promise<WorkspaceStatus> {
    if (this.composition) return this.statusValue;
    this.composition = await createLocalImportController({ ...this.options, workspacePassword: input.password });
    this.statusValue = { state: "ready", workspaceId: await this.composition.controller.getWorkspaceId() };
    await this.onReady?.(this.composition);
    return this.statusValue;
  }

  async enableAppLock(input: { password: string }): Promise<WorkspaceStatus> {
    if (!this.composition?.workspace) throw new Error("WORKSPACE_SECURITY_UNAVAILABLE");
    await enableLocalWorkspaceAppLock(this.composition.workspace, input.password);
    return this.statusValue;
  }

  async disableAppLock(input: { password: string }): Promise<WorkspaceStatus> {
    if (!this.composition?.workspace) throw new Error("WORKSPACE_SECURITY_UNAVAILABLE");
    await disableLocalWorkspaceAppLock(this.composition.workspace, input.password);
    return this.statusValue;
  }

  async createBackup(input: { password: string }) {
    if (!this.composition?.workspace) throw new Error("WORKSPACE_BACKUP_UNAVAILABLE");
    const target = await dialog.showSaveDialog({ title: "Export encrypted workspace backup", defaultPath: join(app.getPath("documents"), "personal-wealth-backup.pwb"), filters: [{ name: "Personal Wealth backup", extensions: ["pwb"] }] });
    if (target.canceled || !target.filePath) throw new Error("BACKUP_CANCELLED");
    return { path: target.filePath, ...(await createBackupService().create({ source: this.composition.workspace.paths, sourceWorkspaceId: this.composition.workspace.workspaceId as never, workspaceDek: this.composition.workspace.workspaceDek, password: input.password, destinationPath: target.filePath })) };
  }

  async restoreBackup(input: { password: string }) {
    const source = await dialog.showOpenDialog({ title: "Restore encrypted workspace backup", properties: ["openFile"], filters: [{ name: "Personal Wealth backup", extensions: ["pwb"] }] });
    if (source.canceled || !source.filePaths[0]) throw new Error("BACKUP_CANCELLED");
    const workspaceId = randomUUID() as never;
    const baseDir = join(app.getPath("userData"), "workspace");
    const vault = {
      async putWorkspaceSecret(workspaceId: string, _slotId: never, secret: string) {
        if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error("WORKSPACE_KEY_PROTECTION_UNAVAILABLE");
        const key = Buffer.from(secret, "base64");
        if (key.byteLength !== 32) throw new Error("WORKSPACE_KEY_INVALID");
        const keyPath = join(baseDir, "workspace-key.json");
        await writeFile(keyPath, JSON.stringify({ version: 1, workspaceId, encryptedKey: safeStorage.encryptString(key.toString("base64")).toString("base64") }), { encoding: "utf8", mode: 0o600 });
        await chmod(keyPath, 0o600);
      },
      async getWorkspaceSecret() { return null; },
      async deleteWorkspaceSecret() { return undefined; },
      async listWorkspaceSlots() { return []; },
    };
    const verification = await createBackupService({ verifyDatabase: async (filePath, key) => {
      const connection = await openSqlCipher({ filePath, key, mode: "read-only" });
      try {
        const integrity = await connection.all<{ quick_check: string }>("PRAGMA cipher_integrity_check");
        if (integrity.some((row) => String(row.quick_check).toLowerCase() !== "ok")) throw new Error("BACKUP_RESTORE_INTEGRITY_FAILED");
        const count = async (table: string): Promise<number> => Number((await connection.get<{ count: number }>(`SELECT count(*) AS count FROM ${table}`))?.count ?? 0);
        return { integrityCheck: "ok", accountCount: await count("account"), journalCount: await count("journal_entry"), objectCount: 0, fxQuoteCount: await count("fx_quote") };
      } finally { await connection.close(); key.fill(0); }
    } }).restore({ backupPath: source.filePaths[0], password: input.password, workspaceBaseDir: baseDir, newWorkspaceId: workspaceId, targetVault: vault, targetSystemSlotId: randomUUID() as never });
    return { workspaceId, ...verification.verification };
  }

  async close(): Promise<void> { await this.composition?.close(); this.composition = undefined; }
}
