import { WorkspaceAppLockInputSchema, WorkspaceBackupPasswordSchema, WorkspaceRestoreResultSchema, WorkspaceStatusSchema, WorkspaceUnlockInputSchema, WorkspaceBackupResultSchema } from "@pwm/contracts";
import type { LocalWorkspaceSession } from "./workspace-session";

export interface WorkspaceIpcRegistrar {
  handle(channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>): void;
  removeHandler?(channel: string): void;
}

const channels = ["workspace:status", "workspace:unlock", "workspace:enable-app-lock", "workspace:disable-app-lock", "workspace:create-backup", "workspace:restore-backup"] as const;

export function registerWorkspaceIpc(ipc: WorkspaceIpcRegistrar, session: LocalWorkspaceSession): () => void {
  ipc.handle("workspace:status", async () => WorkspaceStatusSchema.parse(await session.status()));
  ipc.handle("workspace:unlock", async (_event, payload) => WorkspaceStatusSchema.parse(await session.unlock(WorkspaceUnlockInputSchema.parse(payload))));
  ipc.handle("workspace:enable-app-lock", async (_event, payload) => WorkspaceStatusSchema.parse(await session.enableAppLock(WorkspaceAppLockInputSchema.parse(payload))));
  ipc.handle("workspace:disable-app-lock", async (_event, payload) => WorkspaceStatusSchema.parse(await session.disableAppLock(WorkspaceAppLockInputSchema.parse(payload))));
  ipc.handle("workspace:create-backup", async (_event, payload) => WorkspaceBackupResultSchema.parse(await session.createBackup(WorkspaceBackupPasswordSchema.parse(payload))));
  ipc.handle("workspace:restore-backup", async (_event, payload) => WorkspaceRestoreResultSchema.parse(await session.restoreBackup(WorkspaceBackupPasswordSchema.parse(payload))));
  return () => { for (const channel of channels) ipc.removeHandler?.(channel); };
}
