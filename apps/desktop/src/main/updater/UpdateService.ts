import type { UpdateRelease, UpdateStatus } from "@pwm/contracts";
import { updateStatusSchema } from "@pwm/contracts";
import { evaluateUpdate, type MigrationPreflight } from "./update-policy";

export interface UpdateProvider {
  checkForUpdates(): Promise<UpdateRelease | null>;
  downloadUpdate(version: string): Promise<void>;
  installOnQuit(): void;
}

export interface UpdateDependencies {
  readonly provider: UpdateProvider;
  readonly migration: { preflight(schemaVersion: number): Promise<MigrationPreflight> };
  readonly tasks: { assertNoNonResumableTasks(): Promise<void> };
  readonly workspace: { createMigrationCheckpoint(): Promise<void> };
}

export class UpdateService {
  private current: UpdateStatus = { state: "idle" };

  constructor(private readonly dependencies: UpdateDependencies) {}

  get status(): UpdateStatus {
    return this.current;
  }

  async check(): Promise<UpdateStatus> {
    this.current = { state: "checking" };
    try {
      const release = await this.dependencies.provider.checkForUpdates();
      if (release === null) {
        this.current = { state: "unavailable", reason: "service-unavailable" };
        return this.current;
      }
      const migration = await this.dependencies.migration.preflight(release.schemaVersion);
      this.current = updateStatusSchema.parse(evaluateUpdate(release, migration));
      return this.current;
    } catch (error) {
      this.current = {
        state: "unavailable",
        reason: error instanceof TypeError ? "invalid-response" : "offline",
      };
      return this.current;
    }
  }

  async download(version: string): Promise<UpdateStatus> {
    if (this.current.state !== "available" || this.current.version !== version) {
      this.current = { state: "blocked", reason: "untrusted-signature" };
      return this.current;
    }
    await this.dependencies.provider.downloadUpdate(version);
    this.current = { state: "downloaded", version };
    return this.current;
  }

  async installOnQuit(): Promise<void> {
    if (this.current.state !== "downloaded") throw new Error("UPDATE_NOT_DOWNLOADED");
    await this.dependencies.tasks.assertNoNonResumableTasks();
    await this.dependencies.workspace.createMigrationCheckpoint();
    this.dependencies.provider.installOnQuit();
  }
}
