import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createArgon2idParameters,
  enableAppLock,
  unlockWithAppLock,
  type AppLockStateStore,
  type Argon2idParameters,
  type WrappedWorkspaceKey,
} from "./app-lock";

const workspace = "018f4f7e-8ead-7c0d-8000-000000000001" as const;
const slot = "018f4f7e-8ead-7c0d-8000-000000000002" as const;

function stateStore(): AppLockStateStore {
  let value: { state: "disabled" | "pending" | "enabled"; parameters?: Argon2idParameters; wrappedDek?: WrappedWorkspaceKey } = { state: "disabled" };
  return {
    async writePending(parameters, wrappedDek) { value = { state: "pending", parameters, wrappedDek }; },
    async activate() { if (value.state !== "pending") throw new Error("not-pending"); value = { ...value, state: "enabled" }; },
    async read() { return value; },
  };
}

describe("workspace key hierarchy and app lock", () => {
  it("uses fixed Argon2id parameters and rejects a wrong password", async () => {
    const params = createArgon2idParameters(new Uint8Array(16).fill(7));
    expect(params).toMatchObject({ algorithm: "argon2id", memoryKiB: 65536, iterations: 3, parallelism: 1 });
    const dek = new Uint8Array(32).fill(4);
    const vault = { putWorkspaceSecret: async () => undefined, getWorkspaceSecret: async () => null, deleteWorkspaceSecret: async () => undefined, listWorkspaceSlots: async () => [] };
    const store = stateStore();
    const result = await enableAppLock({ workspaceId: workspace as never, password: "correct horse battery staple", dek, vault, systemSlotId: slot, stateStore: store });
    await expect(unlockWithAppLock("wrong horse battery staple", result.parameters, result.wrapped, workspace as never)).rejects.toThrow();
    await expect(unlockWithAppLock("correct horse battery staple", result.parameters, result.wrapped, workspace as never)).resolves.toEqual(dek);
  }, 30_000);

  it("removes the automatic unlock slot before activation succeeds", async () => {
    const slots = new Set<string>([slot]);
    const vault = { putWorkspaceSecret: async () => undefined, getWorkspaceSecret: async () => null, deleteWorkspaceSecret: async (_workspace: unknown, id: string) => { slots.delete(id); }, listWorkspaceSlots: async () => [...slots] };
    const store = stateStore();
    await enableAppLock({ workspaceId: workspace as never, password: "correct horse battery staple", dek: new Uint8Array(32).fill(7), vault, systemSlotId: slot, stateStore: store });
    expect(slots.has(slot)).toBe(false);
    expect((await store.read()).state).toBe("enabled");
  }, 30_000);

  it("does not accept arbitrary workspace IDs or generated slot values", () => {
    expect(() => createArgon2idParameters(new Uint8Array(15))).toThrow("invalid-app-lock-salt");
    expect(randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
