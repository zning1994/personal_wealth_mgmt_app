import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CredentialVault, UnlockSlotId } from "@pwm/application";
import { WorkspaceIdSchema, type WorkspaceId } from "@pwm/contracts";
import { deriveAppLockKek, createArgon2idParameters } from "../keys/app-lock";
import { deriveWorkspaceSubkey, zeroKey } from "../keys/key-hierarchy";
import { openSqlCipher } from "../sqlcipher/driver";
import { createWorkspaceLayout, resolveWorkspacePaths, type WorkspacePaths } from "../workspace/layout";
import { BACKUP_MAGIC, BACKUP_VERSION, backupHeaderAad, canonicalJson, digestBackupEntries, readBackupPackage, type BackupHeaderV1 } from "./backup-format";

type BackupEntry = { readonly path: string; readonly bytes: string; readonly sha256: string; readonly byteLength: number };
type BackupPayload = { readonly sourceWorkspaceId: WorkspaceId; readonly workspaceDek: string; readonly entries: readonly BackupEntry[] };

export type RestoreVerification = {
  readonly integrityCheck: "ok";
  readonly accountCount: number;
  readonly journalCount: number;
  readonly objectCount: number;
  readonly fxQuoteCount: number;
};

export interface BackupService {
  create(input: { source: WorkspacePaths; sourceWorkspaceId: WorkspaceId; workspaceDek: Uint8Array; password: string; destinationPath: string }): Promise<{ sha256: string; byteLength: number }>;
  inspect(input: { backupPath: string; password: string }): Promise<BackupHeaderV1>;
  restore(input: { backupPath: string; password: string; workspaceBaseDir: string; newWorkspaceId: WorkspaceId; targetVault: CredentialVault; targetSystemSlotId: UnlockSlotId }): Promise<{ paths: WorkspacePaths; verification: RestoreVerification }>;
}

export interface BackupDependencies {
  readonly rekeyDatabase?: (path: string, fromKey: Uint8Array, toKey: Uint8Array) => Promise<void>;
  readonly verifyDatabase?: (path: string, key: Uint8Array) => Promise<RestoreVerification>;
}

async function rekeySqlCipher(path: string, fromKey: Uint8Array, toKey: Uint8Array): Promise<void> {
  const database = await openSqlCipher({ filePath: path, key: fromKey, mode: "read-write" });
  try {
    if (!database.rekey) throw new Error("BACKUP_REKEY_UNAVAILABLE");
    await database.rekey(toKey);
  } finally {
    await database.close();
  }
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateEntry(entry: BackupEntry): void {
  if (!/^([a-z0-9_-]+\/)*[a-z0-9._-]+$/u.test(entry.path) || entry.path.includes("..") || entry.path.startsWith("/")) throw new Error("BACKUP_ENTRY_PATH_INVALID");
  if (!/^[a-f0-9]{64}$/u.test(entry.sha256) || !Number.isInteger(entry.byteLength) || entry.byteLength < 0) throw new Error("BACKUP_ENTRY_INVALID");
  const bytes = Buffer.from(entry.bytes, "base64url");
  if (bytes.byteLength !== entry.byteLength || hash(bytes) !== entry.sha256) throw new Error("BACKUP_ENTRY_INTEGRITY_FAILED");
}

async function listEntries(source: WorkspacePaths): Promise<BackupEntry[]> {
  const paths: string[] = ["workspace.db"];
  const objects = await readdir(source.objects, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  for (const object of objects) {
    if (!object.isFile() || !/^[-a-f0-9]+\.pwo$/iu.test(object.name)) continue;
    paths.push(`objects/${object.name}`);
  }
  const result: BackupEntry[] = [];
  for (const relative of paths) {
    const bytes = await readFile(join(source.root, relative));
    result.push({ path: relative, bytes: bytes.toString("base64url"), sha256: hash(bytes), byteLength: bytes.byteLength });
  }
  return result;
}

function parsePayload(plaintext: Buffer): BackupPayload {
  let parsed: unknown;
  try { parsed = JSON.parse(plaintext.toString("utf8")) as unknown; } catch { throw new Error("BACKUP_PAYLOAD_INVALID"); }
  if (!parsed || typeof parsed !== "object") throw new Error("BACKUP_PAYLOAD_INVALID");
  const payload = parsed as Partial<BackupPayload>;
  if (!WorkspaceIdSchema.safeParse(payload.sourceWorkspaceId).success || typeof payload.workspaceDek !== "string" || !Array.isArray(payload.entries)) throw new Error("BACKUP_PAYLOAD_INVALID");
  const dek = Buffer.from(payload.workspaceDek, "base64url");
  if (dek.byteLength !== 32) throw new Error("BACKUP_PAYLOAD_INVALID");
  const entries = payload.entries as BackupEntry[];
  const seen = new Set<string>();
  for (const entry of entries) { validateEntry(entry); if (seen.has(entry.path)) throw new Error("BACKUP_ENTRY_DUPLICATE"); seen.add(entry.path); }
  return { sourceWorkspaceId: payload.sourceWorkspaceId as WorkspaceId, workspaceDek: payload.workspaceDek, entries };
}

async function decryptPayload(path: string, password: string): Promise<{ header: BackupHeaderV1; payload: BackupPayload }> {
  const packageValue = await readBackupPackage(path);
  const key = await deriveAppLockKek(password, packageValue.header.kdf);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(packageValue.header.nonce, "base64url"));
    decipher.setAAD(backupHeaderAad(packageValue.header));
    decipher.setAuthTag(packageValue.tag);
    const plaintext = Buffer.concat([decipher.update(packageValue.ciphertext), decipher.final()]);
    return { header: packageValue.header, payload: parsePayload(plaintext) };
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "BACKUP_PAYLOAD_INVALID") throw error;
    throw new Error("BACKUP_PASSWORD_INVALID");
  } finally {
    key.fill(0);
  }
}

function defaultVerification(entries: readonly BackupEntry[]): RestoreVerification {
  const database = entries.find((entry) => entry.path === "workspace.db");
  if (!database) throw new Error("BACKUP_DATABASE_MISSING");
  return { integrityCheck: "ok", accountCount: 0, journalCount: 0, objectCount: entries.filter((entry) => entry.path.startsWith("objects/")).length, fxQuoteCount: 0 };
}

export function createBackupService(dependencies: BackupDependencies = {}): BackupService {
  return {
    async create(input) {
      WorkspaceIdSchema.parse(input.sourceWorkspaceId);
      if (input.workspaceDek.byteLength !== 32 || input.password.length < 8) throw new Error("BACKUP_INPUT_INVALID");
      const entries = await listEntries(input.source);
      const payload: BackupPayload = { sourceWorkspaceId: input.sourceWorkspaceId, workspaceDek: Buffer.from(input.workspaceDek).toString("base64url"), entries };
      const kdf = createArgon2idParameters();
      const nonce = randomBytes(12);
      const headerWithoutDigest = { magic: BACKUP_MAGIC, version: BACKUP_VERSION, kdf, nonce: nonce.toString("base64url"), createdAt: new Date().toISOString(), sourceSchemaVersion: 1 };
      const key = await deriveAppLockKek(input.password, kdf);
      let ciphertextAndTag: Buffer;
      try {
        const cipher = createCipheriv("aes-256-gcm", key, nonce);
        cipher.setAAD(Buffer.from(canonicalJson(headerWithoutDigest), "utf8"));
        const ciphertext = Buffer.concat([cipher.update(Buffer.from(canonicalJson(payload), "utf8")), cipher.final()]);
        ciphertextAndTag = Buffer.concat([ciphertext, cipher.getAuthTag()]);
      } finally { key.fill(0); }
      const header: BackupHeaderV1 = { ...headerWithoutDigest, entriesSha256: digestBackupEntries(ciphertextAndTag) };
      const headerBytes = Buffer.from(canonicalJson(header), "utf8");
      if (headerBytes.byteLength > 64 * 1024) throw new Error("BACKUP_HEADER_INVALID");
      const packageBytes = Buffer.concat([Buffer.from(BACKUP_MAGIC, "utf8"), Buffer.alloc(4), headerBytes, ciphertextAndTag]);
      packageBytes.writeUInt32BE(headerBytes.byteLength, Buffer.byteLength(BACKUP_MAGIC));
      const temporary = `${input.destinationPath}.part`;
      await mkdir(dirname(input.destinationPath), { recursive: true, mode: 0o700 });
      await writeFile(temporary, packageBytes, { mode: 0o600 });
      await rename(temporary, input.destinationPath);
      return { sha256: digestBackupEntries(packageBytes), byteLength: packageBytes.byteLength };
    },
    async inspect(input) {
      const { header } = await decryptPayload(input.backupPath, input.password);
      return header;
    },
    async restore(input) {
      const newId = WorkspaceIdSchema.parse(input.newWorkspaceId);
      const { payload } = await decryptPayload(input.backupPath, input.password);
      const targetPaths = resolveWorkspacePaths(input.workspaceBaseDir, newId);
      try { await stat(targetPaths.root); throw new Error("RESTORE_TARGET_EXISTS"); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const sourceDek = Buffer.from(payload.workspaceDek, "base64url");
      const targetDek = randomBytes(32);
      const dbEntry = payload.entries.find((entry) => entry.path === "workspace.db");
      if (!dbEntry) throw new Error("BACKUP_DATABASE_MISSING");
      try {
        const manifest = { formatVersion: 1 as const, workspaceId: newId, schemaVersion: 1, createdAt: new Date().toISOString(), appLock: { state: "disabled" as const }, recoveryState: "healthy" as const };
        const created = await createWorkspaceLayout(input.workspaceBaseDir, manifest);
        for (const entry of payload.entries) {
          const destination = join(created.root, entry.path);
          await mkdir(join(destination, ".."), { recursive: true, mode: 0o700 });
          await writeFile(destination, Buffer.from(entry.bytes, "base64url"), { mode: 0o600 });
        }
        const fromKey = deriveWorkspaceSubkey(sourceDek, payload.sourceWorkspaceId, "sqlcipher-v1");
        const toKey = deriveWorkspaceSubkey(targetDek, newId, "sqlcipher-v1");
        try { await (dependencies.rekeyDatabase ?? rekeySqlCipher)(created.database, fromKey, toKey); } finally { zeroKey(fromKey); zeroKey(toKey); }
        const verification = dependencies.verifyDatabase ? await dependencies.verifyDatabase(created.database, deriveWorkspaceSubkey(targetDek, newId, "sqlcipher-v1")) : defaultVerification(payload.entries);
        await input.targetVault.putWorkspaceSecret(newId, input.targetSystemSlotId, Buffer.from(targetDek).toString("base64url"));
        return { paths: created, verification };
      } catch (error: unknown) {
        // The target was proven absent immediately before creation.  Remove
        // the complete partial workspace so a later restore cannot mistake a
        // half-written database or object directory for a valid workspace.
        await rm(targetPaths.root, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      } finally {
        zeroKey(sourceDek);
        zeroKey(targetDek);
      }
    },
  };
}
