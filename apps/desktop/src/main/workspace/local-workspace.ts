import { app, safeStorage } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createManifestAppLockStateStore, createWorkspaceLayout, deriveWorkspaceSubkey, enableAppLock, EncryptedSourceObjectStore, FileBinaryObjectBackend, openWorkspaceDatabase, readWorkspaceManifest, resolveWorkspacePaths, unlockWithAppLock, writeWorkspaceManifest, type WorkspaceDatabase, type WorkspaceManifest, type WorkspacePaths } from "@pwm/storage";
import type { UnlockSlotId } from "@pwm/application";
import type { SourceDocumentStore } from "@pwm/application";
import { WorkspaceIdSchema } from "@pwm/contracts";

type ProtectedKeyEnvelope = { version: 1; encryptedKey: string; workspaceId?: string };

export type LocalWorkspace = WorkspaceDatabase & { workspaceId: string; sourceDocuments: SourceDocumentStore; paths: WorkspacePaths; appLockState: WorkspaceManifest["appLock"]["state"]; workspaceDek: Uint8Array };

export type LocalWorkspaceStatus = { readonly state: "new" | "ready" | "locked" | "recovery"; readonly workspaceId?: string };

function uuidFromKey(key: Uint8Array): string {
  const bytes = createHash("sha256").update(key).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function readProtectedKey(path: string): Promise<{ key: Uint8Array; workspaceId?: string } | null> {
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
  if (envelope.version !== 1 || typeof envelope.encryptedKey !== "string" || envelope.encryptedKey.length === 0 || (envelope.workspaceId !== undefined && !WorkspaceIdSchema.safeParse(envelope.workspaceId).success)) throw new Error("WORKSPACE_KEY_FILE_INVALID");
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error("WORKSPACE_KEY_PROTECTION_UNAVAILABLE");
  const decoded = safeStorage.decryptString(Buffer.from(envelope.encryptedKey, "base64"));
  const key = Buffer.from(decoded, "base64");
  if (key.byteLength !== 32) throw new Error("WORKSPACE_KEY_INVALID");
  return { key: new Uint8Array(key), ...(typeof envelope.workspaceId === "string" ? { workspaceId: envelope.workspaceId } : {}) };
}

async function loadOrCreateProtectedKey(path: string): Promise<{ key: Uint8Array; workspaceId: string }> {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error("WORKSPACE_KEY_PROTECTION_UNAVAILABLE");
  const existing = await readProtectedKey(path);
  if (existing) return { key: existing.key, workspaceId: existing.workspaceId ?? uuidFromKey(existing.key) };
  const key = randomBytes(32);
  let workspaceId = uuidFromKey(key);
  const envelope: ProtectedKeyEnvelope = { version: 1, workspaceId, encryptedKey: safeStorage.encryptString(key.toString("base64")).toString("base64") };
  await writeFile(path, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600, flag: "wx" }).catch(async (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const raced = await readProtectedKey(path);
    if (!raced) throw new Error("WORKSPACE_KEY_FILE_RACE");
    key.fill(0);
    key.set(raced.key);
    workspaceId = raced.workspaceId ?? uuidFromKey(raced.key);
    raced.key.fill(0);
  });
  await chmod(path, 0o600);
  return { key: new Uint8Array(key), workspaceId };
}

async function writeProtectedKey(path: string, key: Uint8Array, workspaceId?: string): Promise<void> {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error("WORKSPACE_KEY_PROTECTION_UNAVAILABLE");
  const envelope: ProtectedKeyEnvelope = { version: 1, encryptedKey: safeStorage.encryptString(Buffer.from(key).toString("base64")).toString("base64"), ...(workspaceId === undefined ? {} : { workspaceId }) };
  await writeFile(path, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

function workspaceBaseDirectory(): string {
  return join(app.getPath("userData"), "workspace");
}

async function locateManifest(baseDirectory: string): Promise<{ paths: WorkspacePaths; manifest: WorkspaceManifest } | null> {
  const entries = await readdir(baseDirectory, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const paths = resolveWorkspacePaths(baseDirectory, entry.name as never);
      const manifest = await readWorkspaceManifest(paths);
      return { paths, manifest };
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "WORKSPACE_MANIFEST_MISSING") continue;
      // A malformed manifest in a UUID workspace is recoverable only through
      // the recovery workflow; never silently create a second workspace.
      if (error instanceof Error && error.message === "WORKSPACE_MANIFEST_INVALID") throw error;
      // Ignore unrelated directories in the user-data workspace root.
    }
  }
  return null;
}

export async function inspectLocalWorkspace(): Promise<LocalWorkspaceStatus> {
  const base = workspaceBaseDirectory();
  const keyPath = join(base, "workspace-key.json");
  const protectedKey = await readProtectedKey(keyPath);
  if (protectedKey) {
    const workspaceId = protectedKey.workspaceId ?? uuidFromKey(protectedKey.key);
    protectedKey.key.fill(0);
    const paths = resolveWorkspacePaths(base, workspaceId as never);
    try {
      const manifest = await readWorkspaceManifest(paths);
      if (manifest.workspaceId !== workspaceId) throw new Error("WORKSPACE_KEY_INVALID");
      return { state: manifest.appLock.state === "disabled" ? "ready" : "locked", workspaceId };
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "WORKSPACE_MANIFEST_MISSING") return { state: "new", workspaceId };
      throw error;
    }
  }
  const located = await locateManifest(base);
  return located ? { state: located.manifest.appLock.state === "disabled" ? "recovery" : "locked", workspaceId: located.manifest.workspaceId } : { state: "new" };
}

export async function openLocalWorkspace(options: { readonly password?: string } = {}): Promise<LocalWorkspace> {
  const root = workspaceBaseDirectory();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const keyPath = join(root, "workspace-key.json");
  const protectedEnvelope = await readProtectedKey(keyPath);
  const protectedKey = protectedEnvelope?.key;
  let key: Uint8Array;
  let paths: WorkspacePaths;
  let manifest: WorkspaceManifest;
  const located = await locateManifest(root);
  if (protectedKey) {
    const workspaceId = protectedEnvelope?.workspaceId ?? uuidFromKey(protectedKey);
    paths = resolveWorkspacePaths(root, workspaceId as never);
    if (located?.paths.root === paths.root) manifest = located.manifest;
    else if (located) throw new Error("WORKSPACE_KEY_INVALID");
    else {
      try { manifest = await readWorkspaceManifest(paths); }
      catch (error: unknown) {
        if (!(error instanceof Error) || error.message !== "WORKSPACE_MANIFEST_MISSING") throw error;
        const fresh = { formatVersion: 1 as const, workspaceId: workspaceId as never, schemaVersion: 1, createdAt: new Date().toISOString(), appLock: { state: "disabled" as const }, recoveryState: "healthy" as const };
        paths = await createWorkspaceLayout(root, fresh);
        manifest = fresh;
      }
    }
    if (manifest.appLock.state === "disabled") key = protectedKey;
    else {
      protectedKey.fill(0);
      if (!options.password) throw new Error("WORKSPACE_APP_LOCK_REQUIRED");
      try { key = await unlockWithAppLock(options.password, manifest.appLock.parameters!, manifest.appLock.wrappedDek!, manifest.workspaceId); } catch { throw new Error("WORKSPACE_PASSWORD_INVALID"); }
    }
  } else if (located) {
    paths = located.paths;
    manifest = located.manifest;
    if (manifest.appLock.state === "disabled") throw new Error("WORKSPACE_KEY_MISSING");
    if (!options.password) throw new Error("WORKSPACE_APP_LOCK_REQUIRED");
    try { key = await unlockWithAppLock(options.password, manifest.appLock.parameters!, manifest.appLock.wrappedDek!, manifest.workspaceId); } catch { throw new Error("WORKSPACE_PASSWORD_INVALID"); }
  } else {
    const created = await loadOrCreateProtectedKey(keyPath);
    key = created.key;
    const workspaceId = created.workspaceId;
    paths = resolveWorkspacePaths(root, workspaceId as never);
    manifest = await (async () => {
      try { return await readWorkspaceManifest(paths); } catch (error: unknown) { if (error instanceof Error && error.message === "WORKSPACE_MANIFEST_MISSING") { paths = await createWorkspaceLayout(root, { formatVersion: 1 as const, workspaceId: workspaceId as never, schemaVersion: 1, createdAt: new Date().toISOString(), appLock: { state: "disabled" as const }, recoveryState: "healthy" as const }); return { formatVersion: 1 as const, workspaceId: workspaceId as never, schemaVersion: 1, createdAt: new Date().toISOString(), appLock: { state: "disabled" as const }, recoveryState: "healthy" as const }; } throw error; }
    })();
  }
  if (manifest.appLock.state === "pending") { key.fill(0); throw new Error("WORKSPACE_APP_LOCK_PENDING"); }
  if (manifest.workspaceId !== (protectedEnvelope?.workspaceId ?? manifest.workspaceId)) { key.fill(0); throw new Error("WORKSPACE_KEY_INVALID"); }
  const workspaceId = manifest.workspaceId;
  const databaseKey = deriveWorkspaceSubkey(key, workspaceId as never, "sqlcipher-v1");
  const sourceObjectKey = deriveWorkspaceSubkey(key, workspaceId as never, "source-object-v1");
  let handedOffSourceKey = false;
  let handedOffWorkspaceKey = false;
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
    handedOffWorkspaceKey = true;
    return { ...database, workspaceId, paths, appLockState: manifest.appLock.state, workspaceDek: key, sourceDocuments, close: async () => { try { await close(); } finally { sourceObjectKey.fill(0); key.fill(0); } } };
  } finally {
    databaseKey.fill(0);
    if (!handedOffWorkspaceKey) key.fill(0);
    if (!handedOffSourceKey) sourceObjectKey.fill(0);
  }
}

function workspacePathsFor(workspace: LocalWorkspace): WorkspacePaths {
  return workspace.paths;
}

async function protectedKeyPathFor(workspace: LocalWorkspace): Promise<string> {
  return join(workspacePathsFor(workspace).root, "..", "workspace-key.json");
}

export async function enableLocalWorkspaceAppLock(workspace: LocalWorkspace, password: string): Promise<void> {
  const keyPath = await protectedKeyPathFor(workspace);
  const protectedEnvelope = await readProtectedKey(keyPath);
  if (!protectedEnvelope) throw new Error("WORKSPACE_KEY_MISSING");
  const key = protectedEnvelope.key;
  const stateStore = createManifestAppLockStateStore(workspace.paths);
  const systemSlotId = crypto.randomUUID() as UnlockSlotId;
  const vault = {
    async putWorkspaceSecret() { throw new Error("credential-vault-unavailable"); },
    async getWorkspaceSecret() { return null; },
    async deleteWorkspaceSecret() { await rm(keyPath, { force: true }); },
    async listWorkspaceSlots() { try { await stat(keyPath); return [systemSlotId]; } catch { return []; } },
  };
  try { await enableAppLock({ workspaceId: workspace.workspaceId as never, password, dek: key, vault, systemSlotId, stateStore }); } finally { key.fill(0); }
}

export async function disableLocalWorkspaceAppLock(workspace: LocalWorkspace, password: string): Promise<void> {
  const manifest = await readWorkspaceManifest(workspace.paths);
  if (manifest.appLock.state === "disabled") return;
  if (manifest.appLock.state !== "enabled" || !manifest.appLock.parameters || !manifest.appLock.wrappedDek) throw new Error("WORKSPACE_APP_LOCK_PENDING");
  const key = await unlockWithAppLock(password, manifest.appLock.parameters, manifest.appLock.wrappedDek, workspace.workspaceId as never).catch(() => { throw new Error("WORKSPACE_PASSWORD_INVALID"); });
  try {
    await writeProtectedKey(await protectedKeyPathFor(workspace), key, workspace.workspaceId);
    await writeWorkspaceManifest(workspace.paths, { ...manifest, appLock: { state: "disabled" } });
  } finally { key.fill(0); }
}
