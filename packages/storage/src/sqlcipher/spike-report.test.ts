import { describe, expect, it } from "vitest";
import { assertSpikeReport, parseSpikeReport } from "./spike-report";

const passingReport = {
  platform: "darwin",
  arch: "arm64",
  electronVersion: "43.2.0",
  bindingVersion: "12.11.1",
  officialSqlCipherVersion: "SQLCipher 4.6.1 Community",
  cipherImplementation: "better-sqlite3-multiple-ciphers",
  cipherMode: "sqlcipher-legacy-4",
  wrongKeyRejected: true,
  plaintextHits: [],
  crashArtifactsClean: true,
  backupRoundTrip: true,
  packagedNativeLoad: true,
  sqlCipher4Compatibility: true,
  signedPackageLaunch: true,
};

describe("SQLCipher spike report gate", () => {
  it("accepts only a complete report matching the controlled runner", () => {
    expect(
      assertSpikeReport(parseSpikeReport(passingReport), {
        platform: "darwin",
        arch: "arm64",
      }),
    ).toEqual(passingReport);
  });

  it.each([
    ["wrong key acceptance", { wrongKeyRejected: false }, "sqlcipher-spike-gate-failed"],
    [
      "plaintext hit",
      { plaintextHits: [{ path: "artifact.bin", needleIndex: 0, offset: 1 }] },
      "sqlcipher-spike-gate-failed",
    ],
    ["dirty crash artifact", { crashArtifactsClean: false }, "sqlcipher-spike-gate-failed"],
    ["failed backup", { backupRoundTrip: false }, "sqlcipher-spike-gate-failed"],
    ["package native load failure", { packagedNativeLoad: false }, "sqlcipher-spike-gate-failed"],
    ["incompatible official fixture", { sqlCipher4Compatibility: false }, "sqlcipher-spike-gate-failed"],
    ["default sqleet mode", { cipherMode: "sqleet" }, "invalid-sqlcipher-spike-report"],
    ["wrong implementation", { cipherImplementation: "other" }, "invalid-sqlcipher-spike-report"],
    ["unsigned package", { signedPackageLaunch: false }, "sqlcipher-spike-gate-failed"],
    ["wrong Electron", { electronVersion: "43.1.0" }, "sqlcipher-spike-gate-failed"],
    ["wrong binding", { bindingVersion: "12.11.0" }, "sqlcipher-spike-gate-failed"],
    ["unobserved official CLI", { officialSqlCipherVersion: "unobserved" }, "sqlcipher-spike-gate-failed"],
  ])("rejects %s", (_name, change, expectedError) => {
    expect(() =>
      assertSpikeReport(parseSpikeReport({ ...passingReport, ...change }), {
        platform: "darwin",
        arch: "arm64",
      }),
    ).toThrow(expectedError);
  });

  it("rejects a report produced on a runner that does not match its label", () => {
    expect(() =>
      assertSpikeReport(parseSpikeReport(passingReport), {
        platform: "darwin",
        arch: "x64",
      }),
    ).toThrow("sqlcipher-spike-runner-mismatch");
  });

  it("rejects missing, unknown, and malformed report fields", () => {
    const missingArch = Object.fromEntries(
      Object.entries(passingReport).filter(([key]) => key !== "arch"),
    );
    expect(() => parseSpikeReport(missingArch)).toThrow("invalid-sqlcipher-spike-report");
    expect(() => parseSpikeReport({ ...passingReport, skipped: true })).toThrow(
      "invalid-sqlcipher-spike-report",
    );
    expect(() => parseSpikeReport({ ...passingReport, plaintextHits: "none" })).toThrow(
      "invalid-sqlcipher-spike-report",
    );
  });
});
