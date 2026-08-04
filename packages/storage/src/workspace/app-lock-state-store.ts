import type { AppLockStateStore, Argon2idParameters, WrappedWorkspaceKey } from "../keys/app-lock";
import { readWorkspaceManifest, writeWorkspaceManifest, type WorkspacePaths } from "./layout";

export function createManifestAppLockStateStore(paths: WorkspacePaths): AppLockStateStore {
  return {
    async writePending(parameters: Argon2idParameters, wrapped: WrappedWorkspaceKey): Promise<void> {
      const manifest = await readWorkspaceManifest(paths);
      await writeWorkspaceManifest(paths, { ...manifest, appLock: { state: "pending", parameters, wrappedDek: wrapped } });
    },
    async activate(): Promise<void> {
      const manifest = await readWorkspaceManifest(paths);
      if (manifest.appLock.state !== "pending" || !manifest.appLock.parameters || !manifest.appLock.wrappedDek) throw new Error("app-lock-pending-state-invalid");
      await writeWorkspaceManifest(paths, { ...manifest, appLock: { state: "enabled", parameters: manifest.appLock.parameters, wrappedDek: manifest.appLock.wrappedDek } });
    },
    async read() {
      const manifest = await readWorkspaceManifest(paths);
      return manifest.appLock;
    },
  };
}
