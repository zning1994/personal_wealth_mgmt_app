import { z } from "zod";
import { WorkspaceIdSchema, type WorkspaceId } from "@pwm/contracts";

export const UnlockSlotIdSchema = z.string().uuid();
export type UnlockSlotId = z.infer<typeof UnlockSlotIdSchema>;

export const UnlockSlotKindSchema = z.enum(["system-auto", "app-lock"]);
export type UnlockSlotKind = z.infer<typeof UnlockSlotKindSchema>;

export const CredentialVaultErrorCodeSchema = z.enum([
  "credential-vault-denied",
  "credential-vault-unavailable",
  "credential-vault-missing",
]);
export type CredentialVaultErrorCode = z.infer<
  typeof CredentialVaultErrorCodeSchema
>;

export interface CredentialVault {
  putWorkspaceSecret(
    workspaceId: WorkspaceId,
    slotId: UnlockSlotId,
    secret: string,
  ): Promise<void>;
  getWorkspaceSecret(
    workspaceId: WorkspaceId,
    slotId: UnlockSlotId,
  ): Promise<string | null>;
  deleteWorkspaceSecret(
    workspaceId: WorkspaceId,
    slotId: UnlockSlotId,
  ): Promise<void>;
  listWorkspaceSlots(workspaceId: WorkspaceId): Promise<readonly UnlockSlotId[]>;
}

export function parseWorkspaceId(value: string): WorkspaceId {
  return WorkspaceIdSchema.parse(value);
}

export function credentialVaultError(
  code: CredentialVaultErrorCode,
): Error & { readonly code: CredentialVaultErrorCode } {
  const error = new Error(code) as Error & {
    readonly code: CredentialVaultErrorCode;
  };
  Object.defineProperty(error, "code", { value: code, enumerable: true });
  return error;
}
