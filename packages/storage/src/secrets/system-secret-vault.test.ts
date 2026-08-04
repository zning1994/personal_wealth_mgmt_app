import { describe, expect, it } from "vitest";
import { SystemSecretVault } from "./system-secret-vault";

describe("SystemSecretVault", () => {
  it("returns an opaque ref and keeps the secret only in the credential backend", async () => {
    const values = new Map<string, string>();
    const vault = new SystemSecretVault({
      setPassword: async (service, account, secret) => { values.set(`${service}:${account}`, secret); },
      getPassword: async (service, account) => values.get(`${service}:${account}`) ?? null,
      deletePassword: async (service, account) => values.delete(`${service}:${account}`),
    });
    const ref = await vault.store({ workspaceId: "ws-1", providerId: "openai", purpose: "api_key" }, "sk-synthetic-secret");
    expect(JSON.stringify(ref)).not.toContain("sk-synthetic-secret");
    await expect(vault.resolve(ref)).resolves.toBe("sk-synthetic-secret");
  });

  it("fails closed for a missing credential", async () => {
    const vault = new SystemSecretVault({ setPassword: async () => undefined, getPassword: async () => null, deletePassword: async () => false });
    await expect(vault.resolve({ id: crypto.randomUUID(), service: "PersonalWealthMgmt", account: "missing" })).rejects.toThrow("SECRET_NOT_FOUND");
  });

  it("rejects references for another service", async () => {
    const vault = new SystemSecretVault({ setPassword: async () => undefined, getPassword: async () => null, deletePassword: async () => false });
    await expect(vault.resolve({ id: crypto.randomUUID(), service: "Other" as never, account: "account" })).rejects.toThrow("SECRET_REF_INVALID");
  });
});
