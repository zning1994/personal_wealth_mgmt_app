import { describe, expect, it } from "vitest";
import { deriveWorkspaceSubkey, generateWorkspaceDek } from "./key-hierarchy";

const workspace = "018f4f7e-8ead-7c0d-8000-000000000001" as const;

describe("workspace key hierarchy", () => {
  it("derives deterministic, purpose-isolated 256-bit keys", () => {
    const dek = generateWorkspaceDek();
    const sql = deriveWorkspaceSubkey(dek, workspace as never, "sqlcipher-v1");
    const source = deriveWorkspaceSubkey(dek, workspace as never, "source-object-v1");
    const checkpoint = deriveWorkspaceSubkey(dek, workspace as never, "checkpoint-v1");
    expect(sql.byteLength).toBe(32);
    expect(new Set([Buffer.from(sql).toString("hex"), Buffer.from(source).toString("hex"), Buffer.from(checkpoint).toString("hex")]).size).toBe(3);
    expect(deriveWorkspaceSubkey(dek, workspace as never, "sqlcipher-v1")).toEqual(sql);
  });

  it("rejects malformed DEKs", () => {
    expect(() => deriveWorkspaceSubkey(new Uint8Array(31), workspace as never, "sqlcipher-v1")).toThrow("invalid-workspace-dek");
  });
});
