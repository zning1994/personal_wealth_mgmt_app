export type SourceRetentionPolicy = "encrypted_copy" | "parsed_only";
export type PutSourceDocumentInput = { workspaceId: string; bytes: Uint8Array; mimeType: string; extension: string; retention: SourceRetentionPolicy };
export type SourceDocumentMetadata = { sha256: string; byteLength: number; mimeType: string; extension: string; objectKey?: string };

export interface SourceDocumentStore {
  put(input: PutSourceDocumentInput): Promise<SourceDocumentMetadata>;
  read(workspaceId: string, objectKey: string): Promise<Uint8Array>;
  delete(workspaceId: string, objectKey: string): Promise<void>;
}
