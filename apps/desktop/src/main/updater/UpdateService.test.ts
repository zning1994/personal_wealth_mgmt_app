import { describe, expect, it, vi } from "vitest";
import { UpdateService } from "./UpdateService";

function dependencies() {
  return {
    provider: {
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      installOnQuit: vi.fn(),
    },
    migration: { preflight: vi.fn(async () => ({ canProceed: true as const })) },
    tasks: { assertNoNonResumableTasks: vi.fn(async () => undefined) },
    workspace: { createMigrationCheckpoint: vi.fn(async () => undefined) },
  };
}

describe("UpdateService", () => {
  it("keeps the current app usable when update checks are offline", async () => {
    const deps = dependencies();
    deps.provider.checkForUpdates.mockRejectedValue(new Error("offline"));
    const service = new UpdateService(deps);
    await expect(service.check()).resolves.toEqual({ state: "unavailable", reason: "offline" });
    expect(deps.workspace.createMigrationCheckpoint).not.toHaveBeenCalled();
  });

  it("rejects an untrusted release before download", async () => {
    const deps = dependencies();
    deps.provider.checkForUpdates.mockResolvedValue({ version: "0.1.1", releaseUrl: "https://example.invalid/release", signatureTrusted: false, schemaVersion: 1 });
    const service = new UpdateService(deps);
    await expect(service.check()).resolves.toEqual({ state: "blocked", reason: "untrusted-signature" });
    await expect(service.download("0.1.1")).resolves.toEqual({ state: "blocked", reason: "untrusted-signature" });
    expect(deps.provider.downloadUpdate).not.toHaveBeenCalled();
  });

  it("creates a migration checkpoint immediately before opt-in install", async () => {
    const deps = dependencies();
    deps.provider.checkForUpdates.mockResolvedValue({ version: "0.1.1", releaseUrl: "https://example.invalid/release", signatureTrusted: true, schemaVersion: 1 });
    const service = new UpdateService(deps);
    await service.check();
    await service.download("0.1.1");
    await service.installOnQuit();
    expect(deps.tasks.assertNoNonResumableTasks).toHaveBeenCalledOnce();
    expect(deps.workspace.createMigrationCheckpoint).toHaveBeenCalledOnce();
    expect(deps.provider.installOnQuit).toHaveBeenCalledOnce();
  });
});
