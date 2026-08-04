export type SecretScope = {
  readonly workspaceId: string;
  readonly providerId: string;
  readonly purpose: "api_key" | `header:${string}`;
};

export type SecretRef = {
  readonly id: string;
  readonly service: "PersonalWealthMgmt";
  readonly account: string;
};

/**
 * The application layer only sees an opaque reference.  Implementations live
 * at the desktop/storage boundary and are allowed to talk to Keychain or
 * Credential Manager, but the reference itself must never contain the value.
 */
export interface SecretVault {
  store(scope: SecretScope, secret: string): Promise<SecretRef>;
  resolve(ref: SecretRef): Promise<string>;
  delete(ref: SecretRef): Promise<void>;
}
