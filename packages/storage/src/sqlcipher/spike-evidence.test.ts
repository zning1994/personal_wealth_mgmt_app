import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSqlCipher } from "./driver";
import {
  isCipherIntegrityClean,
  isOfficialSqlCipher4Version,
  parseElectronCrashMarker,
  readLoadedBindingVersion,
  scanCrashArtifactsBeforeRecovery,
  verifyWrongKeyRejected,
} from "./spike-evidence";
import { assertSpikeReport, parseSpikeReport } from "./spike-report";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("SQLCipher spike evidence", () => {
  it("accepts only an explicit SQLite NOTADB wrong-key rejection", async () => {
    expect(
      await verifyWrongKeyRejected(async () => {
        throw Object.assign(new Error("SQLITE_NOTADB: file is not a database"), {
          code: "SQLITE_NOTADB",
          errno: 26,
        });
      }),
    ).toBe(true);
    expect(
      await verifyWrongKeyRejected(async () => {
        throw Object.assign(new Error("disk I/O error"), { code: "SQLITE_IOERR", errno: 10 });
      }),
    ).toBe(false);
    expect(await verifyWrongKeyRejected(async () => { throw new Error("unrelated"); })).toBe(false);
  });

  it("closes a connection when a wrong-key open unexpectedly succeeds", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pwm-wrong-key-evidence-"));
    temporaryRoots.push(root);
    const filePath = path.join(root, "workspace.db");
    const key = randomBytes(32);
    const database = await openSqlCipher({ filePath, key, mode: "read-write" });
    await database.close();

    await expect(
      verifyWrongKeyRejected(() => openSqlCipher({ filePath, key, mode: "read-only" })),
    ).resolves.toBe(false);
    await expect(rm(root, { recursive: true })).resolves.toBeUndefined();
    temporaryRoots.pop();
  });

  it("treats every cipher_integrity_check row as corruption evidence", () => {
    expect(isCipherIntegrityClean([])).toBe(true);
    expect(isCipherIntegrityClean([{ cipher_integrity_check: "ok" }])).toBe(false);
    expect(isCipherIntegrityClean([{ cipher_integrity_check: "corrupt" }])).toBe(false);
  });

  it("accepts only an identified SQLCipher major version 4 or newer", () => {
    expect(isOfficialSqlCipher4Version("3.45.2 2024-03-12 SQLite")).toBe(false);
    expect(isOfficialSqlCipher4Version("SQLite 4.0.0 with SQLCipher compatibility")).toBe(false);
    expect(isOfficialSqlCipher4Version("SQLCipher 3.4.2 Community")).toBe(false);
    expect(isOfficialSqlCipher4Version("SQLCipher 4.6.1 Community")).toBe(true);
    expect(isOfficialSqlCipher4Version("Zetetic-SQLCipher/4.6.1", String.raw`Zetetic-SQLCipher/(\d+)\.`)).toBe(true);
    expect(isOfficialSqlCipher4Version("SQLCipher 4.6.1", "[")).toBe(false);
  });

  it("scans an active WAL before recovery removes it and fails the report gate", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pwm-active-wal-"));
    temporaryRoots.push(root);
    const walPath = path.join(root, "workspace.db-wal");
    const canary = Buffer.from("ACTIVE_WAL_账户_884422", "utf8");
    await writeFile(walPath, Buffer.concat([Buffer.alloc(31), canary]));

    const evidence = await scanCrashArtifactsBeforeRecovery([root], [canary], async () => {
      await rm(walPath);
      return "recovered";
    });

    expect(evidence).toEqual({
      plaintextHits: [{ path: walPath, needleIndex: 0, offset: 31 }],
      recovery: "recovered",
    });
    expect(() =>
      assertSpikeReport(
        parseSpikeReport({
          platform: "darwin",
          arch: "arm64",
          electronVersion: "43.2.0",
          bindingVersion: "12.11.1",
          cipherImplementation: "better-sqlite3-multiple-ciphers",
          cipherMode: "sqlcipher-legacy-4",
          wrongKeyRejected: true,
          plaintextHits: evidence.plaintextHits,
          crashArtifactsClean: true,
          backupRoundTrip: true,
          packagedNativeLoad: true,
          sqlCipher4Compatibility: true,
          signedPackageLaunch: true,
        }),
        { platform: "darwin", arch: "arm64" },
      ),
    ).toThrow("sqlcipher-spike-gate-failed");
  });

  it("records a scan failure before performing recovery", async () => {
    const missingRoot = path.join(tmpdir(), `pwm-missing-scan-${randomBytes(8).toString("hex")}`);
    let recovered = false;

    await expect(
      scanCrashArtifactsBeforeRecovery([missingRoot], [Buffer.from("canary")], async () => {
        recovered = true;
        return "recovered";
      }),
    ).resolves.toEqual({
      plaintextHits: [{ path: "plaintext-scan-failed", needleIndex: 0, offset: 0 }],
      recovery: "recovered",
    });
    expect(recovered).toBe(true);
  });

  it("parses the Electron version observed by the crash worker", () => {
    expect(
      parseElectronCrashMarker(JSON.stringify({
        state: "transaction-open",
        electronVersion: "43.2.0",
      })),
    ).toEqual({ state: "transaction-open", electronVersion: "43.2.0" });
    expect(parseElectronCrashMarker("transaction-open")).toBeUndefined();
    expect(parseElectronCrashMarker('{"state":"binding-loaded"}')).toBeUndefined();
  });

  it("reads the version from the loaded SQLCipher package manifest", async () => {
    await expect(readLoadedBindingVersion()).resolves.toBe("12.11.1");
  });
});
