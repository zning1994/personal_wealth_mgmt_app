import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { PutSourceDocumentInput, SourceDocumentMetadata, SourceDocumentStore } from "@pwm/application";

export interface WorkspaceKeyProvider { getWorkspaceObjectKey(workspaceId: string): Promise<Uint8Array> }
export interface BinaryObjectBackend { put(key: string, value: Uint8Array): Promise<void>; get(key: string): Promise<Uint8Array>; delete(key: string): Promise<void> }

export class EncryptedSourceObjectStore implements SourceDocumentStore {
  constructor(private readonly keys: WorkspaceKeyProvider, private readonly backend: BinaryObjectBackend) {}
  async put(input: PutSourceDocumentInput): Promise<SourceDocumentMetadata> {
    const base = { sha256: createHash("sha256").update(input.bytes).digest("hex"), byteLength: input.bytes.byteLength, mimeType: input.mimeType, extension: input.extension };
    if (input.retention === "parsed_only") return base;
    const key = await this.keys.getWorkspaceObjectKey(input.workspaceId);
    if (key.byteLength !== 32) throw new Error("INVALID_WORKSPACE_OBJECT_KEY");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(input.bytes), cipher.final()]);
    const objectKey = `${input.workspaceId}/${randomUUID()}`;
    await this.backend.put(objectKey, Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));
    return { ...base, objectKey };
  }
  async read(workspaceId: string, objectKey: string): Promise<Uint8Array> {
    this.assertWorkspaceObject(workspaceId, objectKey);
    const payload = await this.backend.get(objectKey);
    if (payload.byteLength < 29) throw new Error("INVALID_ENCRYPTED_SOURCE_OBJECT");
    const decipher = createDecipheriv("aes-256-gcm", await this.keys.getWorkspaceObjectKey(workspaceId), payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    return new Uint8Array(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]));
  }
  async delete(workspaceId: string, objectKey: string): Promise<void> { this.assertWorkspaceObject(workspaceId, objectKey); await this.backend.delete(objectKey); }
  private assertWorkspaceObject(workspaceId: string, objectKey: string): void { if (!objectKey.startsWith(`${workspaceId}/`)) throw new Error("SOURCE_SCOPE_MISMATCH"); }
}
