import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectArtifact } from "./verify-artifact.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture(architecture: string, files: readonly string[]) {
  const root = await mkdtemp(join(tmpdir(), "pwm-artifact-"));
  roots.push(root);
  await mkdir(join(root, "resources", "app"), { recursive: true });
  await writeFile(join(root, "artifact-manifest.json"), JSON.stringify({ architecture }));
  for (const file of files) {
    const path = join(root, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "synthetic");
  }
  return root;
}

describe("inspectArtifact", () => {
  it("rejects a wrong architecture and unpacked secret", async () => {
    const root = await createFixture("ia32", [".env", "resources/app/main.js"]);
    const result = inspectArtifact(root, { architecture: "x64" });
    expect(result.errors.map((item) => item.code)).toEqual(
      expect.arrayContaining(["ARCH_MISMATCH", "SENSITIVE_FILE"]),
    );
  });

  it("accepts a synthetic clean artifact and produces a stable digest", async () => {
    const root = await createFixture("x64", ["resources/app/main.js"]);
    const result = inspectArtifact(root, { architecture: "x64" });
    expect(result.errors).toEqual([]);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
