import type { PlaintextHit } from "./plaintext-probe";

export interface SqlCipherSpikeReport {
  readonly platform: "darwin" | "win32";
  readonly arch: "arm64" | "x64";
  readonly electronVersion: string;
  readonly bindingVersion: string;
  readonly wrongKeyRejected: boolean;
  readonly plaintextHits: readonly PlaintextHit[];
  readonly crashArtifactsClean: boolean;
  readonly backupRoundTrip: boolean;
  readonly signedPackageLaunch: boolean;
}

export interface ExpectedSpikeRunner {
  readonly platform: SqlCipherSpikeReport["platform"];
  readonly arch: SqlCipherSpikeReport["arch"];
}

const reportKeys = [
  "platform",
  "arch",
  "electronVersion",
  "bindingVersion",
  "wrongKeyRejected",
  "plaintextHits",
  "crashArtifactsClean",
  "backupRoundTrip",
  "signedPackageLaunch",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlaintextHit(value: unknown): value is PlaintextHit {
  if (!isRecord(value) || Object.keys(value).length !== 3) return false;
  return (
    typeof value.path === "string" &&
    typeof value.needleIndex === "number" &&
    Number.isInteger(value.needleIndex) &&
    value.needleIndex >= 0 &&
    typeof value.offset === "number" &&
    Number.isSafeInteger(value.offset) &&
    value.offset >= 0
  );
}

export function parseSpikeReport(value: unknown): SqlCipherSpikeReport {
  if (!isRecord(value)) throw new Error("invalid-sqlcipher-spike-report");
  const keys = Object.keys(value).sort();
  if (keys.length !== reportKeys.length || reportKeys.some((key) => !keys.includes(key))) {
    throw new Error("invalid-sqlcipher-spike-report");
  }
  if (
    (value.platform !== "darwin" && value.platform !== "win32") ||
    (value.arch !== "arm64" && value.arch !== "x64") ||
    typeof value.electronVersion !== "string" ||
    value.electronVersion.length === 0 ||
    typeof value.bindingVersion !== "string" ||
    value.bindingVersion.length === 0 ||
    typeof value.wrongKeyRejected !== "boolean" ||
    !Array.isArray(value.plaintextHits) ||
    !value.plaintextHits.every(isPlaintextHit) ||
    typeof value.crashArtifactsClean !== "boolean" ||
    typeof value.backupRoundTrip !== "boolean" ||
    typeof value.signedPackageLaunch !== "boolean"
  ) {
    throw new Error("invalid-sqlcipher-spike-report");
  }

  return value as unknown as SqlCipherSpikeReport;
}

export function assertSpikeReport(
  report: SqlCipherSpikeReport,
  expectedRunner: ExpectedSpikeRunner,
): SqlCipherSpikeReport {
  if (report.platform !== expectedRunner.platform || report.arch !== expectedRunner.arch) {
    throw new Error("sqlcipher-spike-runner-mismatch");
  }
  if (
    !report.wrongKeyRejected ||
    report.electronVersion !== "43.2.0" ||
    report.bindingVersion !== "6.0.0" ||
    report.plaintextHits.length !== 0 ||
    !report.crashArtifactsClean ||
    !report.backupRoundTrip ||
    !report.signedPackageLaunch
  ) {
    throw new Error("sqlcipher-spike-gate-failed");
  }
  return report;
}
