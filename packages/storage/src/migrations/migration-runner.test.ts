import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openSqlCipher } from "../sqlcipher/driver";
import { createWorkspaceLayout } from "../workspace/layout";
import { runMigrations } from "./migration-runner";

describe("checkpointed migrations", () => {
  it("stops at the first verification failure and leaves an encrypted checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "pwm-migrations-"));
    const paths = await createWorkspaceLayout(root, { formatVersion: 1, workspaceId: "018f4f7e-8ead-7c0d-8000-000000000001" as never, schemaVersion: 0, createdAt: "2026-08-05T00:00:00.000Z", appLock: { state: "disabled" }, recoveryState: "healthy" });
    const connection = await openSqlCipher({ filePath: paths.database, key: new Uint8Array(32).fill(9), mode: "read-write" });
    await connection.exec("CREATE TABLE IF NOT EXISTS seed (id INTEGER)");
    await expect(runMigrations({ connection, paths, currentVersion: 0, migrations: [{ version: 1, name: "bad", up: async () => undefined, verify: async () => { throw new Error("synthetic-failure"); } }, { version: 2, name: "never", up: async () => { throw new Error("must-not-run"); }, verify: async () => undefined }] })).rejects.toMatchObject({ code: "migration-failed" });
    await expect((await import("./migration-runner")).checkpointAvailable(paths)).resolves.toBe(true);
    await connection.close();
  });
});
