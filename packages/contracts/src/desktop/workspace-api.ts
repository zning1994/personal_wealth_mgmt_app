import { z } from "zod";
import { WorkspaceIdSchema } from "../ids";

export const WorkspaceStatusSchema = z.object({
  state: z.enum(["new", "ready", "locked", "recovery"]),
  workspaceId: WorkspaceIdSchema.optional(),
}).strict();
export const WorkspaceUnlockInputSchema = z.object({ password: z.string().min(8).max(256) }).strict();
export const WorkspaceAppLockInputSchema = z.object({ password: z.string().min(8).max(256) }).strict();
export const WorkspaceBackupPasswordSchema = z.object({ password: z.string().min(8).max(256) }).strict();
export const WorkspaceBackupResultSchema = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().positive() }).strict();
export const WorkspaceRestoreResultSchema = z.object({ workspaceId: WorkspaceIdSchema, accountCount: z.number().int().nonnegative(), journalCount: z.number().int().nonnegative(), objectCount: z.number().int().nonnegative(), fxQuoteCount: z.number().int().nonnegative() }).strict();

export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;
export type WorkspaceUnlockInput = z.infer<typeof WorkspaceUnlockInputSchema>;
export type WorkspaceAppLockInput = z.infer<typeof WorkspaceAppLockInputSchema>;
export type WorkspaceBackupPassword = z.infer<typeof WorkspaceBackupPasswordSchema>;
export type WorkspaceBackupResult = z.infer<typeof WorkspaceBackupResultSchema>;
export type WorkspaceRestoreResult = z.infer<typeof WorkspaceRestoreResultSchema>;

export interface WorkspaceApi {
  status(): Promise<WorkspaceStatus>;
  unlock(input: WorkspaceUnlockInput): Promise<WorkspaceStatus>;
  enableAppLock(input: WorkspaceAppLockInput): Promise<WorkspaceStatus>;
  disableAppLock(input: WorkspaceAppLockInput): Promise<WorkspaceStatus>;
  createBackup(input: WorkspaceBackupPassword): Promise<WorkspaceBackupResult>;
  restoreBackup(input: WorkspaceBackupPassword): Promise<WorkspaceRestoreResult>;
}
