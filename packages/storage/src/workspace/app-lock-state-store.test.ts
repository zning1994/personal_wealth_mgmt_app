import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createArgon2idParameters } from "../keys/app-lock";
import { createWorkspaceLayout } from "./layout";
import { createManifestAppLockStateStore } from "./app-lock-state-store";

describe("manifest app lock state", () => {
  it("persists pending before enabled and preserves the wrapped envelope", async () => {
    const root = await mkdtemp(join(tmpdir(), "pwm-app-lock-manifest-"));
    const paths = await createWorkspaceLayout(root, { formatVersion: 1, workspaceId: "018f4f7e-8ead-7c0d-8000-000000000001" as never, schemaVersion: 1, createdAt: "2026-08-05T00:00:00.000Z", appLock: { state: "disabled" }, recoveryState: "healthy" });
    const store = createManifestAppLockStateStore(paths);
    const parameters = createArgon2idParameters(new Uint8Array(16).fill(2));
    const wrapped = { version: 1 as const, algorithm: "A256GCM" as const, nonce: "AA", ciphertext: "BB", authTag: "CC" };
    await store.writePending(parameters, wrapped);
    expect((await store.read()).state).toBe("pending");
    await store.activate();
    expect((await store.read()).state).toBe("enabled");
  });
});
