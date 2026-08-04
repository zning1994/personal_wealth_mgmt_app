import { hkdfSync, randomBytes } from "node:crypto";
import { WorkspaceIdSchema, type WorkspaceId } from "@pwm/contracts";

export const KEY_PURPOSES = [
  "sqlcipher-v1",
  "source-object-v1",
  "checkpoint-v1",
] as const;
export type KeyPurpose = (typeof KEY_PURPOSES)[number];

export function generateWorkspaceDek(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

export function deriveWorkspaceSubkey(
  dek: Uint8Array,
  workspaceId: WorkspaceId,
  purpose: KeyPurpose,
): Uint8Array {
  if (dek.byteLength !== 32) throw new Error("invalid-workspace-dek");
  const workspace = WorkspaceIdSchema.parse(workspaceId);
  if (!KEY_PURPOSES.includes(purpose)) throw new Error("invalid-key-purpose");
  const derived = hkdfSync(
    "sha256",
    Buffer.from(dek),
    Buffer.from(workspace),
    Buffer.from(`pwm:${purpose}`),
    32,
  );
  return new Uint8Array(derived);
}

export function zeroKey(key: Uint8Array | undefined): void {
  key?.fill(0);
}
