import { app, safeStorage } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createWorkspaceLayout, deriveWorkspaceSubkey, EncryptedSourceObjectStore, FileBinaryObjectBackend, openWorkspaceDatabase, readWorkspaceManifest, resolveWorkspacePaths, type WorkspaceDatabase } from "@pwm/storage";
import type { SourceDocumentStore } from "@pwm/application";

type ProtectedKeyEnvelope = { version: 1; encryptedKey: string };

export type LocalWorkspace = WorkspaceDatabase & { workspaceId: string; sourceDocuments: SourceDocumentStore };

function uuidFromKey(key: Uint8Array): string {
  const bytes = createHash("sha256").update(key).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function readProtectedKey(path: string): Promise<Uint8Array | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let envelope: ProtectedKeyEnvelope;
  try {
    envelope = JSON.parse(raw) as ProtectedKeyEnvelope;
  } catch {
    throw new Error("WORKSPACE_KEY_FILE_INVALID");
  }
  if (envelope.version !== 1 || typeof envelope.encryptedKey !== "string" || envelope.encryptedKey.length === 0) throw new Error("WORKSPACE_KEY_FILE_INVALID");
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error("WORKSPACE_KEY_PROTECTION_UNAVAILABLE");
  const decoded = safeStorage.decryptString(Buffer.from(envelope.encryptedKey, "base64"));
  const key = Buffer.from(decoded, "base64");
  if (key.byteLength !== 32) throw new Error("WORKSPACE_KEY_INVALID");
  return new Uint8Array(key);
}

async function loadOrCreateProtectedKey(path: string): Promise<Uint8Array> {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error("WORKSPACE_KEY_PROTECTION_UNAVAILABLE");
  const existing = await readProtectedKey(path);
  if (existing) return existing;
  const key = randomBytes(32);
  const envelope: ProtectedKeyEnvelope = { version: 1, encryptedKey: safeStorage.encryptString(key.toString("base64")).toString("base64") };
  await writeFile(path, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600, flag: "wx" }).catch(async (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const raced = await readProtectedKey(path);
    if (!raced) throw new Error("WORKSPACE_KEY_FILE_RACE");
    key.fill(0);
    key.set(raced);
  });
  await chmod(path, 0o600);
  return new Uint8Array(key);
}

export async function openLocalWorkspace(): Promise<LocalWorkspace> {
  const root = join(app.getPath("userData"), "workspace");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const key = await loadOrCreateProtectedKey(join(root, "workspace-key.json"));
  const workspaceId = uuidFromKey(key);
  const resolvedPaths = resolveWorkspacePaths(root, workspaceId as never);
  let paths = resolvedPaths;
  try {
    const manifest = await readWorkspaceManifest(resolvedPaths);
    if (manifest.appLock.state !== "disabled") throw new Error("WORKSPACE_APP_LOCK_REQUIRED");
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "WORKSPACE_MANIFEST_MISSING" || error.message === "ENOENT")) paths = await createWorkspaceLayout(root, { formatVersion: 1, workspaceId: workspaceId as never, schemaVersion: 1, createdAt: new Date().toISOString(), appLock: { state: "disabled" }, recoveryState: "healthy" });
    else if (error instanceof Error && error.message === "WORKSPACE_MANIFEST_INVALID") throw error;
    else if (error instanceof Error && error.message === "WORKSPACE_APP_LOCK_REQUIRED") throw error;
    else if ((error as NodeJS.ErrnoException).code === "ENOENT") paths = await createWorkspaceLayout(root, { formatVersion: 1, workspaceId: workspaceId as never, schemaVersion: 1, createdAt: new Date().toISOString(), appLock: { state: "disabled" }, recoveryState: "healthy" });
    else throw error;
  }
  const databaseKey = deriveWorkspaceSubkey(key, workspaceId as never, "sqlcipher-v1");
  const sourceObjectKey = deriveWorkspaceSubkey(key, workspaceId as never, "source-object-v1");
  let handedOffSourceKey = false;
  const filePath = paths.database;
  try {
    const existing = await stat(filePath);
    if (!existing.isFile()) throw new Error("WORKSPACE_DATABASE_INVALID");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    const database = await openWorkspaceDatabase({ filePath, key: databaseKey, mode: "read-write" });
    const sourceDocuments = new EncryptedSourceObjectStore({ getWorkspaceObjectKey: async () => sourceObjectKey }, new FileBinaryObjectBackend(paths.objects));
    const close = database.close;
    handedOffSourceKey = true;
    return { ...database, workspaceId, sourceDocuments, close: async () => { try { await close(); } finally { sourceObjectKey.fill(0); } } };
  } finally {
    databaseKey.fill(0);
    key.fill(0);
    if (!handedOffSourceKey) sourceObjectKey.fill(0);
  }
}
