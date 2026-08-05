import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceLayout } from "../workspace/layout";
import { createRecoveryService } from "./recovery-service";

describe("recovery service", () => {
  it("returns bounded diagnostics and can copy only encrypted bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pwm-recovery-"));
    const paths = await createWorkspaceLayout(root, { formatVersion: 1, workspaceId: "018f4f7e-8ead-7c0d-8000-000000000001" as never, schemaVersion: 1, createdAt: "2026-08-05T00:00:00.000Z", appLock: { state: "disabled" }, recoveryState: "healthy" });
    await writeFile(paths.database, Buffer.from("synthetic-encrypted-bytes"));
    await writeFile(join(paths.objects, "018f4f7e-8ead-7c0d-0000-000000000010.pwo"), Buffer.from("encrypted-object"));
    const service = createRecoveryService({ workspaceId: "018f4f7e-8ead-7c0d-8000-000000000001" as never, paths, databaseKey: new Uint8Array(32).fill(1) });
    const diagnostic = await service.diagnose();
    expect(diagnostic.mode).toBe("read-only");
    expect(diagnostic.checks.find((check) => check.name === "objects")?.result).toBe("ok");
    expect(diagnostic.safeActions).toEqual(["open-read-only", "restore-backup-to-new-workspace", "copy-workspace-for-support"]);
    await expect(service.copyForSupport(join(root, "support", "workspace.db"))).resolves.toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
  });
});
