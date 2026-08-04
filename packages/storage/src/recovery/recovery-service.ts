import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { WorkspaceId } from "@pwm/contracts";
import { openSqlCipher, type SqlCipherConnection } from "../sqlcipher/driver";
import { readWorkspaceManifest, type WorkspacePaths } from "../workspace/layout";

export type RecoveryDiagnostic = {
  readonly workspaceId: WorkspaceId;
  readonly mode: "read-only";
  readonly reason: "wrong-key" | "integrity-check-failed" | "migration-failed" | "read-only-recovery" | "checkpoint-invalid";
  readonly checks: readonly { readonly name: "cipher-integrity" | "foreign-keys" | "manifest" | "objects" | "checkpoint"; readonly result: "ok" | "failed" | "not-run" }[];
  readonly safeActions: readonly ["open-read-only", "restore-backup-to-new-workspace", "copy-workspace-for-support"];
};

export interface RecoveryService {
  diagnose(): Promise<RecoveryDiagnostic>;
  openReadOnly(): Promise<SqlCipherConnection>;
  copyForSupport(destination: string): Promise<{ sha256: string }>;
}

export function createRecoveryService(input: { workspaceId: WorkspaceId; paths: WorkspacePaths; databaseKey: Uint8Array }): RecoveryService {
  return {
    async diagnose() {
      const checks: Array<RecoveryDiagnostic["checks"][number]> = [];
      let reason: RecoveryDiagnostic["reason"] = "read-only-recovery";
      try { await readWorkspaceManifest(input.paths); checks.push({ name: "manifest", result: "ok" }); } catch { checks.push({ name: "manifest", result: "failed" }); reason = "integrity-check-failed"; }
      try {
        const connection = await openSqlCipher({ filePath: input.paths.database, key: input.databaseKey, mode: "read-only" });
        try {
          const integrity = await connection.all<{ cipher_integrity_check: string }>("PRAGMA cipher_integrity_check");
          checks.push({ name: "cipher-integrity", result: integrity.every((row) => row.cipher_integrity_check === "ok") ? "ok" : "failed" });
          const foreignKeys = await connection.all<Record<string, unknown>>("PRAGMA foreign_key_check");
          checks.push({ name: "foreign-keys", result: foreignKeys.length === 0 ? "ok" : "failed" });
        } finally { await connection.close(); }
      } catch { checks.push({ name: "cipher-integrity", result: "failed" }); reason = "wrong-key"; checks.push({ name: "foreign-keys", result: "not-run" }); }
      try {
        const entries = await readdir(input.paths.objects, { withFileTypes: true });
        const unsafe = entries.some((entry) => !entry.isFile() || !/^[0-9a-f-]{36}\.pwo$/iu.test(entry.name));
        checks.push({ name: "objects", result: unsafe ? "failed" : "ok" });
      } catch (error: unknown) {
        checks.push({ name: "objects", result: (error as NodeJS.ErrnoException).code === "ENOENT" ? "not-run" : "failed" });
      }
      try { const checkpoint = await stat(input.paths.checkpoints); checks.push({ name: "checkpoint", result: checkpoint.isDirectory() ? "ok" : "failed" }); } catch { checks.push({ name: "checkpoint", result: "not-run" }); }
      return { workspaceId: input.workspaceId, mode: "read-only", reason, checks, safeActions: ["open-read-only", "restore-backup-to-new-workspace", "copy-workspace-for-support"] };
    },
    async openReadOnly() {
      const connection = await openSqlCipher({ filePath: input.paths.database, key: input.databaseKey, mode: "read-only" });
      await connection.exec("PRAGMA query_only = ON");
      return connection;
    },
    async copyForSupport(destination) {
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await copyFile(input.paths.database, destination);
      const digest = createHash("sha256").update(await readFile(destination)).digest("hex");
      return { sha256: digest };
    },
  };
}
