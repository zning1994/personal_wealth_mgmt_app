import { z } from "zod";

export const StorageErrorCodeSchema = z.enum(["wrong-key", "integrity-check-failed", "migration-failed", "read-only-recovery", "checkpoint-invalid"]);
export type StorageErrorCode = z.infer<typeof StorageErrorCodeSchema>;
export const RecoveryStatusSchema = z.object({ mode: z.enum(["read-write", "read-only"]), reason: StorageErrorCodeSchema.optional(), schemaVersion: z.number().int().nonnegative(), checkpointAvailable: z.boolean() }).strict();
export type RecoveryStatus = z.infer<typeof RecoveryStatusSchema>;

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, cause?: unknown) { super(code, cause === undefined ? undefined : { cause }); this.name = "StorageError"; this.code = code; }
}
