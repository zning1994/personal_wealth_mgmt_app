import { randomUUID } from "node:crypto";
import type { SecretRef, SecretScope, SecretVault } from "@pwm/application";

export const SYSTEM_SECRET_SERVICE = "PersonalWealthMgmt" as const;

export interface CredentialBackend {
  setPassword(service: string, account: string, secret: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

function assertRef(ref: SecretRef): void {
  if (ref.service !== SYSTEM_SECRET_SERVICE || !ref.id || !ref.account) {
    throw new Error("SECRET_REF_INVALID");
  }
}

function assertScope(scope: SecretScope): void {
  if (!scope.workspaceId || !scope.providerId || !scope.purpose) {
    throw new Error("SECRET_SCOPE_INVALID");
  }
}

/**
 * Stores provider secrets in a platform credential backend.  Settings files
 * persist only the returned opaque reference; the backend owns the secret.
 */
export class SystemSecretVault implements SecretVault {
  constructor(private readonly backend: CredentialBackend) {}

  async store(scope: SecretScope, secret: string): Promise<SecretRef> {
    assertScope(scope);
    if (secret.length < 1) throw new Error("SECRET_VALUE_INVALID");
    const id = randomUUID();
    const account = `${scope.workspaceId}:${scope.providerId}:${scope.purpose}:${id}`;
    await this.backend.setPassword(SYSTEM_SECRET_SERVICE, account, secret);
    return { id, service: SYSTEM_SECRET_SERVICE, account };
  }

  async resolve(ref: SecretRef): Promise<string> {
    assertRef(ref);
    const secret = await this.backend.getPassword(ref.service, ref.account);
    if (secret === null) throw new Error("SECRET_NOT_FOUND");
    return secret;
  }

  async delete(ref: SecretRef): Promise<void> {
    assertRef(ref);
    await this.backend.deletePassword(ref.service, ref.account);
  }
}
