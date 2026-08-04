import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { SqlCipherConnection } from "./driver";
import { findPlaintext, type PlaintextHit } from "./plaintext-probe";

const require = createRequire(import.meta.url);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExplicitNotADatabaseError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const hasNotADatabaseCode = error.code === "SQLITE_NOTADB" || error.errno === 26;
  const message = typeof error.message === "string" ? error.message : "";
  return hasNotADatabaseCode && /(?:not a database|encrypted)/i.test(message);
}

export async function verifyWrongKeyRejected(
  openAttempt: () => Promise<SqlCipherConnection>,
): Promise<boolean> {
  let connection: SqlCipherConnection;
  try {
    connection = await openAttempt();
  } catch (error: unknown) {
    return isExplicitNotADatabaseError(error);
  }

  try {
    await connection.close();
  } catch {
    // A close failure is not evidence that SQLCipher rejected the supplied key.
  }
  return false;
}

export function isCipherIntegrityClean(rows: readonly Record<string, unknown>[]): boolean {
  return rows.length === 0;
}

const DEFAULT_SQLCIPHER_VERSION_PATTERN = String.raw`\bSQLCipher(?:\s+version)?\s+v?(\d+)(?:\.\d+){1,2}\b`;

export function isOfficialSqlCipher4Version(
  output: string,
  patternSource = DEFAULT_SQLCIPHER_VERSION_PATTERN,
): boolean {
  let pattern: RegExp;
  try {
    pattern = new RegExp(patternSource, "iu");
  } catch {
    return false;
  }
  const match = pattern.exec(output);
  if (!match?.[1] || !/^\d+$/u.test(match[1])) return false;
  return Number(match[1]) >= 4;
}

export async function scanCrashArtifactsBeforeRecovery<T>(
  rootPaths: readonly string[],
  needles: readonly Uint8Array[],
  recover: () => Promise<T>,
): Promise<{ readonly plaintextHits: readonly PlaintextHit[]; readonly recovery: T }> {
  const plaintextHits = await findPlaintext(rootPaths, needles).catch(() => [
    { path: "plaintext-scan-failed", needleIndex: 0, offset: 0 },
  ]);
  const recovery = await recover();
  return { plaintextHits, recovery };
}

export interface ElectronCrashMarker {
  readonly state: "transaction-open";
  readonly electronVersion: string;
}

export function parseElectronCrashMarker(value: string): ElectronCrashMarker | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || Object.keys(parsed).length !== 2) return undefined;
  if (
    parsed.state !== "transaction-open" ||
    typeof parsed.electronVersion !== "string" ||
    parsed.electronVersion.length === 0
  ) {
    return undefined;
  }
  return { state: parsed.state, electronVersion: parsed.electronVersion };
}

export async function readLoadedBindingVersion(): Promise<string> {
  const manifestPath = require.resolve("better-sqlite3-multiple-ciphers/package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (
    !isRecord(manifest) ||
    manifest.name !== "better-sqlite3-multiple-ciphers" ||
    typeof manifest.version !== "string" ||
    manifest.version.length === 0
  ) {
    throw new Error("invalid-sqlcipher-binding-manifest");
  }
  return manifest.version;
}
