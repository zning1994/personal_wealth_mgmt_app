import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Algorithm, hashRaw } from "@node-rs/argon2";
import type {
  CredentialVault,
  UnlockSlotId,
} from "@pwm/application";
import { WorkspaceIdSchema, type WorkspaceId } from "@pwm/contracts";

export type Argon2idParameters = {
  readonly algorithm: "argon2id";
  readonly memoryKiB: 65536;
  readonly iterations: 3;
  readonly parallelism: 1;
  readonly salt: string;
};

export type WrappedWorkspaceKey = {
  readonly version: 1;
  readonly algorithm: "A256GCM";
  readonly nonce: string;
  readonly ciphertext: string;
  readonly authTag: string;
};

export interface AppLockStateStore {
  writePending(
    parameters: Argon2idParameters,
    wrapped: WrappedWorkspaceKey,
  ): Promise<void>;
  activate(): Promise<void>;
  read(): Promise<{ state: "disabled" | "pending" | "enabled"; parameters?: Argon2idParameters; wrappedDek?: WrappedWorkspaceKey }>;
}

const APP_LOCK_MEMORY_KIB = 65_536 as const;
const APP_LOCK_ITERATIONS = 3 as const;
const APP_LOCK_PARALLELISM = 1 as const;

export function createArgon2idParameters(
  salt: Uint8Array = randomBytes(16),
): Argon2idParameters {
  if (salt.byteLength !== 16) throw new Error("invalid-app-lock-salt");
  return {
    algorithm: "argon2id",
    memoryKiB: APP_LOCK_MEMORY_KIB,
    iterations: APP_LOCK_ITERATIONS,
    parallelism: APP_LOCK_PARALLELISM,
    salt: Buffer.from(salt).toString("base64url"),
  };
}

export async function deriveAppLockKek(
  password: string,
  parameters: Argon2idParameters,
): Promise<Uint8Array> {
  if (password.length < 8) throw new Error("app-lock-password-too-short");
  if (
    parameters.algorithm !== "argon2id" ||
    parameters.memoryKiB !== APP_LOCK_MEMORY_KIB ||
    parameters.iterations !== APP_LOCK_ITERATIONS ||
    parameters.parallelism !== APP_LOCK_PARALLELISM
  ) {
    throw new Error("app-lock-parameters-invalid");
  }
  const salt = Buffer.from(parameters.salt, "base64url");
  if (salt.byteLength !== 16) throw new Error("app-lock-salt-invalid");
  return new Uint8Array(
    await hashRaw(password, {
      algorithm: Algorithm.Argon2id,
      memoryCost: parameters.memoryKiB,
      timeCost: parameters.iterations,
      parallelism: parameters.parallelism,
      outputLen: 32,
      salt,
    }),
  );
}

function associatedData(workspaceId: WorkspaceId): Buffer {
  return Buffer.from(`pwm:workspace-key:${workspaceId}:v1`, "utf8");
}

export function wrapWorkspaceDek(
  dek: Uint8Array,
  kek: Uint8Array,
  workspaceId: WorkspaceId,
): WrappedWorkspaceKey {
  WorkspaceIdSchema.parse(workspaceId);
  if (dek.byteLength !== 32 || kek.byteLength !== 32) {
    throw new Error("invalid-workspace-key-material");
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(kek), nonce);
  cipher.setAAD(associatedData(workspaceId));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(dek)), cipher.final()]);
  return {
    version: 1,
    algorithm: "A256GCM",
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function unwrapWorkspaceDek(
  wrapped: WrappedWorkspaceKey,
  kek: Uint8Array,
  workspaceId: WorkspaceId,
): Uint8Array {
  WorkspaceIdSchema.parse(workspaceId);
  if (wrapped.version !== 1 || wrapped.algorithm !== "A256GCM" || kek.byteLength !== 32) {
    throw new Error("app-lock-envelope-invalid");
  }
  const nonce = Buffer.from(wrapped.nonce, "base64url");
  const tag = Buffer.from(wrapped.authTag, "base64url");
  const ciphertext = Buffer.from(wrapped.ciphertext, "base64url");
  if (nonce.byteLength !== 12 || tag.byteLength !== 16 || ciphertext.byteLength !== 32) {
    throw new Error("app-lock-envelope-invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(kek), nonce);
  decipher.setAAD(associatedData(workspaceId));
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

export async function enableAppLock(input: {
  workspaceId: WorkspaceId;
  password: string;
  dek: Uint8Array;
  vault: CredentialVault;
  systemSlotId: UnlockSlotId;
  stateStore: AppLockStateStore;
}): Promise<{ parameters: Argon2idParameters; wrapped: WrappedWorkspaceKey }> {
  const workspaceId = WorkspaceIdSchema.parse(input.workspaceId);
  if (input.dek.byteLength !== 32) throw new Error("invalid-workspace-dek");
  const parameters = createArgon2idParameters();
  const kek = await deriveAppLockKek(input.password, parameters);
  const wrapped = wrapWorkspaceDek(input.dek, kek, workspaceId);
  try {
    await input.stateStore.writePending(parameters, wrapped);
    const pending = await input.stateStore.read();
    if (pending.state !== "pending" || !pending.wrappedDek || !pending.parameters) {
      throw new Error("app-lock-pending-state-invalid");
    }
    const verificationKek = await deriveAppLockKek(input.password, pending.parameters);
    const verificationDek = unwrapWorkspaceDek(pending.wrappedDek, verificationKek, workspaceId);
    verificationKek.fill(0);
    if (!Buffer.from(verificationDek).equals(Buffer.from(input.dek))) {
      verificationDek.fill(0);
      throw new Error("app-lock-verification-failed");
    }
    verificationDek.fill(0);
    await input.vault.deleteWorkspaceSecret(workspaceId, input.systemSlotId);
    const remaining = await input.vault.listWorkspaceSlots(workspaceId);
    if (remaining.includes(input.systemSlotId)) throw new Error("app-lock-system-slot-remains");
    await input.stateStore.activate();
    return { parameters, wrapped };
  } finally {
    kek.fill(0);
  }
}

export async function unlockWithAppLock(
  password: string,
  parameters: Argon2idParameters,
  wrapped: WrappedWorkspaceKey,
  workspaceId: WorkspaceId,
): Promise<Uint8Array> {
  const kek = await deriveAppLockKek(password, parameters);
  try {
    return unwrapWorkspaceDek(wrapped, kek, workspaceId);
  } finally {
    kek.fill(0);
  }
}
