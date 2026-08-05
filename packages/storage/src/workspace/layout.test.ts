import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanStaging, createWorkspaceLayout, readWorkspaceManifest } from "./layout";

const workspaceId = "018f4f7e-8ead-7c0d-8000-000000000001" as never;

describe("workspace layout", () => {
  it("uses opaque paths and cleans interrupted staging files", async () => {
    const base = await mkdtemp(join(tmpdir(), "pwm-layout-"));
    const paths = await createWorkspaceLayout(base, {
      formatVersion: 1,
      workspaceId,
      schemaVersion: 0,
      createdAt: "2026-08-05T00:00:00.000Z",
      appLock: { state: "disabled" },
      recoveryState: "healthy",
    });
    await writeFile(join(paths.staging, "018f4f7e.part"), "synthetic");
    await writeFile(join(paths.staging, "keep.txt"), "synthetic");
    await cleanStaging(paths);
    expect(await readdir(paths.staging)).toEqual(["keep.txt"]);
    await expect(readWorkspaceManifest(paths)).resolves.toMatchObject({ workspaceId });
    expect(JSON.stringify(paths)).not.toMatch(/account|statement|merchant/iu);
  });

  it("rejects traversal and unknown manifest keys", async () => {
    const base = await mkdtemp(join(tmpdir(), "pwm-layout-"));
    await expect(createWorkspaceLayout(base, { formatVersion: 1, workspaceId: "../../etc/passwd" as never, schemaVersion: 0, createdAt: "2026-08-05T00:00:00.000Z", appLock: { state: "disabled" }, recoveryState: "healthy" })).rejects.toThrow();
    const paths = await createWorkspaceLayout(base, { formatVersion: 1, workspaceId, schemaVersion: 0, createdAt: "2026-08-05T00:00:00.000Z", appLock: { state: "disabled" }, recoveryState: "healthy" });
    await writeFile(paths.manifest, JSON.stringify({ formatVersion: 1, workspaceId, schemaVersion: 0, createdAt: "2026-08-05T00:00:00.000Z", appLock: { state: "disabled" }, recoveryState: "healthy", displayName: "Synthetic" }));
    await expect(readWorkspaceManifest(paths)).rejects.toThrow("WORKSPACE_MANIFEST_INVALID");
  });
});
