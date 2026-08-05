import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Argon2idParameters } from "../keys/app-lock";

export const BACKUP_MAGIC = "PWMBACKUP" as const;
export const BACKUP_VERSION = 1 as const;
export const MAX_BACKUP_HEADER_BYTES = 64 * 1024;

export type BackupHeaderV1 = {
  readonly magic: typeof BACKUP_MAGIC;
  readonly version: typeof BACKUP_VERSION;
  readonly kdf: Argon2idParameters;
  readonly nonce: string;
  readonly entriesSha256: string;
  readonly createdAt: string;
  readonly sourceSchemaVersion: number;
};

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function backupHeaderAad(header: BackupHeaderV1): Buffer {
  const withoutDigest = Object.fromEntries(Object.entries(header).filter(([key]) => key !== "entriesSha256"));
  return Buffer.from(canonicalJson(withoutDigest), "utf8");
}

export function digestBackupEntries(ciphertextAndTag: Uint8Array): string {
  return createHash("sha256").update(ciphertextAndTag).digest("hex");
}

export async function readBackupPackage(path: string): Promise<{
  readonly header: BackupHeaderV1;
  readonly ciphertext: Buffer;
  readonly tag: Buffer;
}> {
  const packageBytes = await readFile(path);
  const magic = Buffer.from(BACKUP_MAGIC, "utf8");
  if (!packageBytes.subarray(0, magic.byteLength).equals(magic)) throw new Error("BACKUP_MAGIC_INVALID");
  const headerLengthOffset = magic.byteLength;
  if (packageBytes.byteLength < headerLengthOffset + 4) throw new Error("BACKUP_PACKAGE_TRUNCATED");
  const headerLength = packageBytes.readUInt32BE(headerLengthOffset);
  if (headerLength <= 0 || headerLength > MAX_BACKUP_HEADER_BYTES) throw new Error("BACKUP_HEADER_INVALID");
  const headerStart = headerLengthOffset + 4;
  const headerEnd = headerStart + headerLength;
  if (packageBytes.byteLength < headerEnd + 16) throw new Error("BACKUP_PACKAGE_TRUNCATED");
  let parsed: unknown;
  try { parsed = JSON.parse(packageBytes.subarray(headerStart, headerEnd).toString("utf8")) as unknown; } catch { throw new Error("BACKUP_HEADER_INVALID"); }
  const header = parsed as Partial<BackupHeaderV1>;
  if (header.magic !== BACKUP_MAGIC || header.version !== BACKUP_VERSION || typeof header.entriesSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(header.entriesSha256) || typeof header.nonce !== "string" || typeof header.createdAt !== "string" || !Number.isInteger(header.sourceSchemaVersion) || !header.kdf) throw new Error("BACKUP_HEADER_INVALID");
  const ciphertext = packageBytes.subarray(headerEnd, -16);
  const tag = packageBytes.subarray(-16);
  if (ciphertext.byteLength === 0) throw new Error("BACKUP_PACKAGE_TRUNCATED");
  if (digestBackupEntries(Buffer.concat([ciphertext, tag])) !== header.entriesSha256) throw new Error("BACKUP_INTEGRITY_FAILED");
  return { header: header as BackupHeaderV1, ciphertext, tag };
}
