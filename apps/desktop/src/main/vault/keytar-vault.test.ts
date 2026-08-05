import { describe, expect, it } from "vitest";
import { createKeytarCredentialVault } from "./keytar-vault";

const workspace = "018f4f7e-8ead-7c0d-8000-000000000001";
const slot = "018f4f7e-8ead-7c0d-8000-000000000002";

describe("keytar credential vault", () => {
  it("uses opaque service and account names", async () => {
    const values = new Map<string, string>();
    const calls: string[][] = [];
    const keytar = {
      setPassword: async (...args: string[]) => {
        calls.push(args);
        values.set(`${args[0]}:${args[1]}`, args[2]!);
      },
      getPassword: async (service: string, account: string) =>
        values.get(`${service}:${account}`) ?? null,
      deletePassword: async (service: string, account: string) =>
        values.delete(`${service}:${account}`),
      findCredentials: async () =>
        [...values.entries()].map(([key, password]) => ({
          account: key.split(":").slice(1).join(":"),
          password,
        })),
    };
    const vault = createKeytarCredentialVault(keytar, "darwin", "darwin");
    await vault.putWorkspaceSecret(workspace as never, slot as never, "opaque-secret-value");
    expect(calls[0]?.slice(0, 2)).toEqual([
      "com.personalwealth.workspace",
      `${workspace}:${slot}`,
    ]);
    await expect(vault.getWorkspaceSecret(workspace as never, slot as never)).resolves.toBe(
      "opaque-secret-value",
    );
    expect(JSON.stringify(calls)).toContain("opaque-secret-value");
  });

  it("filters malformed and unrelated slots", async () => {
    const keytar = {
      setPassword: async () => undefined,
      getPassword: async () => null,
      deletePassword: async () => true,
      findCredentials: async () => [
        { account: `${workspace}:${slot}`, password: "x" },
        { account: `${workspace}:not-a-uuid`, password: "x" },
        {
          account: "018f4f7e-8ead-7c0d-8000-000000000099:018f4f7e-8ead-7c0d-8000-000000000003",
          password: "x",
        },
      ],
    };
    const vault = createKeytarCredentialVault(keytar, "darwin", "darwin");
    await expect(vault.listWorkspaceSlots(workspace as never)).resolves.toEqual([slot]);
  });

  it("fails closed on platform mismatch", () => {
    expect(() => createKeytarCredentialVault({} as never, "win32", "darwin"))
      .toThrow("credential-vault-platform-mismatch");
  });
});
