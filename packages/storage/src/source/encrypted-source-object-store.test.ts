import { describe, expect, it } from "vitest";
import { EncryptedSourceObjectStore } from "./encrypted-source-object-store.js";

describe("EncryptedSourceObjectStore", () => {
  it("stores only ciphertext while returning a stable content hash", async () => {
    const objects = new Map<string, Uint8Array>();
    const store = new EncryptedSourceObjectStore(
      { getWorkspaceObjectKey: async () => new Uint8Array(32).fill(7) },
      { put: async (key, value) => void objects.set(key, value), get: async (key) => objects.get(key)!, delete: async (key) => void objects.delete(key) },
    );
    const bytes = new TextEncoder().encode("Synthetic Account 0000");
    const metadata = await store.put({ workspaceId: "018f8f19-2d6a-7b00-8000-000000000099", bytes, mimeType: "text/csv", extension: ".csv", retention: "encrypted_copy" });
    expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(new TextDecoder().decode(objects.get(metadata.objectKey!)!)).not.toContain("Synthetic Account");
    await expect(store.read("018f8f19-2d6a-7b00-8000-000000000099", metadata.objectKey!)).resolves.toEqual(bytes);
  });

  it("does not persist bytes under parsed-only retention", async () => {
    let writes = 0;
    const store = new EncryptedSourceObjectStore(
      { getWorkspaceObjectKey: async () => new Uint8Array(32).fill(9) },
      { put: async () => void writes++, get: async () => new Uint8Array(), delete: async () => undefined },
    );
    const metadata = await store.put({ workspaceId: "018f8f19-2d6a-7b00-8000-000000000099", bytes: new Uint8Array([1]), mimeType: "text/csv", extension: ".csv", retention: "parsed_only" });
    expect(metadata.objectKey).toBeUndefined();
    expect(writes).toBe(0);
  });
});
