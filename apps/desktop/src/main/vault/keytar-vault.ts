import {
  credentialVaultError,
  UnlockSlotIdSchema,
  type CredentialVault,
  type UnlockSlotId,
} from "@pwm/application";
import { WorkspaceIdSchema, type WorkspaceId } from "@pwm/contracts";

export interface KeytarLike {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(
    service: string,
  ): Promise<readonly { account: string; password: string }[]>;
}

const SERVICE = "com.personalwealth.workspace";

function mapVaultError(error: unknown): never {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("denied") || message.includes("permission")) {
    throw credentialVaultError("credential-vault-denied");
  }
  throw credentialVaultError("credential-vault-unavailable");
}

function accountName(workspaceId: WorkspaceId, slotId: UnlockSlotId): string {
  return `${workspaceId}:${slotId}`;
}

function parseAccount(workspaceId: WorkspaceId, account: string): UnlockSlotId | null {
  const prefix = `${workspaceId}:`;
  if (!account.startsWith(prefix)) return null;
  const parsed = UnlockSlotIdSchema.safeParse(account.slice(prefix.length));
  return parsed.success ? parsed.data : null;
}

export function createKeytarCredentialVault(
  keytar: KeytarLike,
  platform: "darwin" | "win32",
  runtimePlatform: string = process.platform,
): CredentialVault {
  if (platform !== runtimePlatform) {
    throw new Error("credential-vault-platform-mismatch");
  }

  return {
    async putWorkspaceSecret(workspaceId, slotId, secret) {
      const workspace = WorkspaceIdSchema.parse(workspaceId);
      const slot = UnlockSlotIdSchema.parse(slotId);
      if (typeof secret !== "string" || secret.length === 0) {
        throw new Error("credential-vault-secret-invalid");
      }
      try {
        await keytar.setPassword(SERVICE, accountName(workspace, slot), secret);
      } catch (error: unknown) {
        mapVaultError(error);
      }
    },
    async getWorkspaceSecret(workspaceId, slotId) {
      const workspace = WorkspaceIdSchema.parse(workspaceId);
      const slot = UnlockSlotIdSchema.parse(slotId);
      try {
        return await keytar.getPassword(SERVICE, accountName(workspace, slot));
      } catch (error: unknown) {
        mapVaultError(error);
      }
    },
    async deleteWorkspaceSecret(workspaceId, slotId) {
      const workspace = WorkspaceIdSchema.parse(workspaceId);
      const slot = UnlockSlotIdSchema.parse(slotId);
      try {
        await keytar.deletePassword(SERVICE, accountName(workspace, slot));
      } catch (error: unknown) {
        mapVaultError(error);
      }
    },
    async listWorkspaceSlots(workspaceId) {
      const workspace = WorkspaceIdSchema.parse(workspaceId);
      try {
        const entries = await keytar.findCredentials(SERVICE);
        const slots = entries
          .map((entry) => parseAccount(workspace, entry.account))
          .filter((slot): slot is UnlockSlotId => slot !== null);
        return [...new Set(slots)];
      } catch (error: unknown) {
        mapVaultError(error);
      }
    },
  };
}

export { SERVICE as WORKSPACE_CREDENTIAL_SERVICE };
