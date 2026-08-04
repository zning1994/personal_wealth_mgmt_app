import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { findPlaintext, type PlaintextHit } from "../src/sqlcipher/plaintext-probe";
import { openSqlCipher } from "../src/sqlcipher/driver";
import {
  isCipherIntegrityClean,
  parseElectronCrashMarker,
  readLoadedBindingVersion,
  scanCrashArtifactsBeforeRecovery,
  verifyWrongKeyRejected,
} from "../src/sqlcipher/spike-evidence";
import type { SqlCipherSpikeReport } from "../src/sqlcipher/spike-report";

const require = createRequire(import.meta.url);
const ELECTRON_VERSION = "43.2.0" as const;
const UTF8_CANARY = Buffer.from("PWM_SPIKE_账户_¥_884422", "utf8");
const UTF16_CANARY = Buffer.from("PWM_SPIKE_UTF16_账户_884422", "utf16le");
const CRASH_CANARY = Buffer.from("PWM_CRASH_账户_998877", "utf8");

interface CommandResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface UtilityCrashEvidence {
  readonly exitedMidTransaction: boolean;
  readonly electronVersion: string | undefined;
}

function runCommand(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly inheritStdio?: boolean;
  } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.inheritStdio ? "inherit" : "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => resolve({ exitCode, signal }));
  });
}

function sqlHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

async function databaseHash(
  connection: Awaited<ReturnType<typeof openSqlCipher>>,
): Promise<string> {
  const rows = await connection.all<{ id: number; value: string }>(
    "SELECT id, hex(value) AS value FROM probe ORDER BY id",
  );
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function forceUtilityCrash(
  root: string,
  databasePath: string,
  key: Uint8Array,
): Promise<UtilityCrashEvidence> {
  const sqliteEntry = require.resolve("@journeyapps/sqlcipher");
  const mainPath = path.join(root, "crash-main.cjs");
  const workerPath = path.join(root, "crash-worker.cjs");
  const markerPath = path.join(root, "crash-transaction-open.marker");
  const mainMarkerPath = path.join(root, "electron-main.marker");

  await writeFile(
    workerPath,
    `const fs = require("node:fs");
fs.writeFileSync(process.env.PWM_SPIKE_MARKER, "worker-started", { mode: 0o600 });
const sqlite3 = require(${JSON.stringify(sqliteEntry)});
fs.writeFileSync(process.env.PWM_SPIKE_MARKER, "binding-loaded", { mode: 0o600 });
const db = new sqlite3.Database(process.env.PWM_SPIKE_DB, sqlite3.OPEN_READWRITE, (openError) => {
  if (openError) { process.parentPort.postMessage({ type: "failure" }); return; }
  const key = process.env.PWM_SPIKE_KEY;
  db.exec(
    'PRAGMA key = "x\\'' + key + '\\'"; PRAGMA cipher_memory_security = ON; BEGIN IMMEDIATE; ' +
      'INSERT INTO probe(value) VALUES (X\\'${sqlHex(CRASH_CANARY)}\\');',
    (error) => {
      if (error) { process.parentPort.postMessage({ type: "failure" }); return; }
      fs.writeFileSync(
        process.env.PWM_SPIKE_MARKER,
        JSON.stringify({ state: "transaction-open", electronVersion: process.versions.electron }),
        { mode: 0o600 },
      );
      process.parentPort.postMessage({ type: "transaction-open" });
      setTimeout(() => process.abort(), 50);
    },
  );
});
`,
    { mode: 0o600 },
  );
  await writeFile(
    mainPath,
    `const fs = require("node:fs");
fs.writeFileSync(process.env.PWM_SPIKE_MAIN_MARKER, "main-started", { mode: 0o600 });
const { app, utilityProcess } = require("electron");
app.commandLine.appendSwitch("headless");
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(() => {
  fs.writeFileSync(process.env.PWM_SPIKE_MAIN_MARKER, "app-ready", { mode: 0o600 });
  fs.writeFileSync(process.env.PWM_SPIKE_MAIN_MARKER, "forking", { mode: 0o600 });
  const worker = utilityProcess.fork(${JSON.stringify(workerPath)}, [], {
    allowLoadingUnsignedLibraries: true,
    env: {
      PWM_SPIKE_DB: process.env.PWM_SPIKE_DB,
      PWM_SPIKE_KEY: process.env.PWM_SPIKE_KEY,
      PWM_SPIKE_MARKER: process.env.PWM_SPIKE_MARKER,
    },
  });
  fs.writeFileSync(process.env.PWM_SPIKE_MAIN_MARKER, "forked", { mode: 0o600 });
  let transactionOpened = false;
  const timeout = setTimeout(() => { worker.kill(); app.exit(2); }, 15000);
  worker.on("message", (message) => {
    if (message && message.type === "transaction-open") {
      transactionOpened = true;
    } else if (message && message.type === "failure") {
      worker.kill();
      app.exit(3);
    }
  });
  worker.once("exit", () => {
    clearTimeout(timeout);
    app.exit(transactionOpened ? 0 : 4);
  });
});
`,
    { mode: 0o600 },
  );

  const launchEnvironment = Object.fromEntries(
    Object.entries({
      ...process.env,
      PWM_SPIKE_DB: databasePath,
      PWM_SPIKE_KEY: Buffer.from(key).toString("hex"),
      PWM_SPIKE_MARKER: markerPath,
      PWM_SPIKE_MAIN_MARKER: mainMarkerPath,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  let result: CommandResult;
  try {
    const { _electron: electron } = await import("@playwright/test");
    const application = await electron.launch({ args: [mainPath], env: launchEnvironment });
    const child = application.process();
    result = await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve({ exitCode: child.exitCode, signal: child.signalCode });
        return;
      }
      child.once("exit", (exitCode, signal) => resolve({ exitCode, signal }));
    });
  } catch (error: unknown) {
    if (process.env.PWM_SQLCIPHER_SPIKE_DEBUG === "1") {
      process.stderr.write(
        `Playwright Electron launch failed: ${error instanceof Error ? error.message : "unknown"}\n`,
      );
    }
    result = { exitCode: null, signal: null };
  }
  if (process.env.PWM_SQLCIPHER_SPIKE_DEBUG === "1") {
    const mainMarker = await readFile(mainMarkerPath, "utf8").catch(() => "missing");
    const workerMarker = await readFile(markerPath, "utf8").catch(() => "missing");
    process.stderr.write(
      `Utility crash probe exit code: ${String(result.exitCode)} signal: ${String(result.signal)} main: ${mainMarker} worker: ${workerMarker}\n`,
    );
  }
  const marker = parseElectronCrashMarker(await readFile(markerPath, "utf8").catch(() => ""));
  return {
    exitedMidTransaction: result.exitCode === 0 && marker !== undefined,
    electronVersion: marker?.electronVersion,
  };
}

async function findPackageRoot(moduleEntry: string): Promise<string> {
  let current = path.dirname(moduleEntry);
  while (current !== path.dirname(current)) {
    try {
      const packageJson = JSON.parse(await readFile(path.join(current, "package.json"), "utf8")) as {
        name?: unknown;
      };
      if (packageJson.name) return current;
    } catch {
      // Continue upward until the package manifest is found.
    }
    current = path.dirname(current);
  }
  throw new Error("package-root-not-found");
}

async function walkFor(
  root: string,
  predicate: (entryPath: string, directory: boolean) => boolean,
): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (predicate(entryPath, entry.isDirectory())) return entryPath;
    if (entry.isDirectory()) {
      const nested = await walkFor(entryPath, predicate);
      if (nested) return nested;
    }
  }
  return undefined;
}

function hasRequiredSigningCredentials(platform: NodeJS.Platform): boolean {
  const common = Boolean(process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD);
  if (platform === "win32") return common;
  if (platform === "darwin") {
    return Boolean(
      common &&
        process.env.APPLE_ID &&
        process.env.APPLE_APP_SPECIFIC_PASSWORD &&
        process.env.APPLE_TEAM_ID,
    );
  }
  return false;
}

async function verifyMacSignature(appPath: string): Promise<boolean> {
  const checks = await Promise.all([
    runCommand("codesign", ["--verify", "--deep", "--strict", appPath]),
    runCommand("xcrun", ["stapler", "validate", appPath]),
    runCommand("spctl", ["--assess", "--type", "execute", appPath]),
  ]);
  return checks.every(({ exitCode }) => exitCode === 0);
}

async function verifyWindowsSignature(executablePath: string): Promise<boolean> {
  const script =
    "if ((Get-AuthenticodeSignature -LiteralPath $env:PWM_PROBE_EXE).Status -eq 'Valid') { exit 0 } else { exit 1 }";
  const result = await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, PWM_PROBE_EXE: executablePath },
  });
  return result.exitCode === 0;
}

async function buildAndLaunchSignedProbe(
  root: string,
  databasePath: string,
  key: Uint8Array,
): Promise<boolean> {
  const platform = process.platform;
  if ((platform !== "darwin" && platform !== "win32") || !hasRequiredSigningCredentials(platform)) {
    return false;
  }

  const appDir = path.join(root, "probe-app");
  const outputDir = path.join(root, "probe-package");
  const resultPath = path.join(root, "probe-launch-result.json");
  await mkdir(appDir, { recursive: true, mode: 0o700 });

  const sqlcipherRoot = await findPackageRoot(require.resolve("@journeyapps/sqlcipher"));
  const bindingsRoot = await findPackageRoot(require.resolve("bindings"));
  const fileUriRoot = await findPackageRoot(require.resolve("file-uri-to-path"));
  await writeFile(
    path.join(appDir, "package.json"),
    JSON.stringify({ name: "pwm-sqlcipher-probe", version: "0.1.0", main: "main.cjs" }),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(appDir, "main.cjs"),
    `const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
app.commandLine.appendSwitch("headless");
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(() => {
  const sqlite3 = require(path.join(process.resourcesPath, "sqlcipher", "lib", "sqlite3.js"));
  const db = new sqlite3.Database(process.env.PWM_SPIKE_DB, sqlite3.OPEN_READONLY, (openError) => {
    if (openError) { app.exit(2); return; }
    db.exec('PRAGMA key = "x\\'' + process.env.PWM_SPIKE_KEY + '\\'"; PRAGMA cipher_memory_security = ON;', (keyError) => {
      if (keyError) { db.close(() => app.exit(3)); return; }
      db.get("SELECT count(*) AS count FROM probe", (queryError, row) => {
        if (queryError || !row || row.count !== 2) { db.close(() => app.exit(4)); return; }
        fs.writeFileSync(process.env.PWM_SPIKE_RESULT, JSON.stringify({ electronVersion: process.versions.electron, bindingOpened: true }));
        db.close((closeError) => app.exit(closeError ? 5 : 0));
      });
    });
  });
});
`,
    { mode: 0o600 },
  );

  const config = {
    appId: "science.techina.pwm.sqlcipher-probe",
    productName: "PwmSqlCipherProbe",
    electronVersion: ELECTRON_VERSION,
    asar: true,
    npmRebuild: false,
    forceCodeSigning: true,
    directories: { app: appDir, output: outputDir },
    files: ["package.json", "main.cjs"],
    extraResources: [
      { from: sqlcipherRoot, to: "sqlcipher" },
      { from: bindingsRoot, to: "node_modules/bindings" },
      { from: fileUriRoot, to: "node_modules/file-uri-to-path" },
    ],
    mac: {
      target: ["dir"],
      hardenedRuntime: true,
      gatekeeperAssess: false,
      notarize: true,
    },
    win: {
      target: ["dir"],
      signAndEditExecutable: true,
    },
  };
  const configPath = path.join(root, "electron-builder.json");
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });

  const builderCli = require.resolve("electron-builder/out/cli/cli.js");
  const targetArgs = platform === "darwin" ? ["--mac", "dir"] : ["--win", "dir"];
  const archArg = process.arch === "arm64" ? "--arm64" : "--x64";
  const buildResult = await runCommand(process.execPath, [builderCli, "--config", configPath, ...targetArgs, archArg], {
    cwd: appDir,
    env: process.env,
  });
  if (buildResult.exitCode !== 0) return false;

  let launchPath: string | undefined;
  let signed = false;
  if (platform === "darwin") {
    const appPath = await walkFor(outputDir, (entryPath, directory) => directory && entryPath.endsWith(".app"));
    if (!appPath) return false;
    signed = await verifyMacSignature(appPath);
    launchPath = path.join(appPath, "Contents", "MacOS", "PwmSqlCipherProbe");
  } else {
    launchPath = await walkFor(
      outputDir,
      (entryPath, directory) => !directory && path.basename(entryPath) === "PwmSqlCipherProbe.exe",
    );
    if (!launchPath) return false;
    signed = await verifyWindowsSignature(launchPath);
  }
  if (!signed || !launchPath) return false;

  const launchResult = await runCommand(launchPath, [], {
    env: {
      ...process.env,
      PWM_SPIKE_DB: databasePath,
      PWM_SPIKE_KEY: Buffer.from(key).toString("hex"),
      PWM_SPIKE_RESULT: resultPath,
    },
  });
  if (launchResult.exitCode !== 0) return false;
  const result = JSON.parse(await readFile(resultPath, "utf8")) as Record<string, unknown>;
  return result.electronVersion === ELECTRON_VERSION && result.bindingOpened === true;
}

async function writeReport(report: SqlCipherSpikeReport): Promise<string> {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const artifactDirectory = path.join(repositoryRoot, "artifacts", "sqlcipher-spike");
  await mkdir(artifactDirectory, { recursive: true });
  const reportPath = path.join(artifactDirectory, `${report.platform}-${report.arch}.json`);
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await rm(reportPath, { force: true });
  await copyFile(temporaryPath, reportPath);
  await rm(temporaryPath, { force: true });
  return reportPath;
}

async function runSpike(): Promise<SqlCipherSpikeReport> {
  if ((process.platform !== "darwin" && process.platform !== "win32") ||
      (process.arch !== "arm64" && process.arch !== "x64")) {
    throw new Error("unsupported-sqlcipher-spike-runner");
  }

  const root = await mkdtemp(path.join(tmpdir(), "pwm-sqlcipher-spike-"));
  const databasePath = path.join(root, "workspace.db");
  const backupPath = path.join(root, "workspace.backup");
  const restoredPath = path.join(root, "workspace-restored.db");
  const key = randomBytes(32);
  let wrongKeyRejected = false;
  let crashArtifactsClean = false;
  let backupRoundTrip = false;
  let signedPackageLaunch = false;
  let electronVersion = "unobserved";
  let bindingVersion = "unobserved";
  let plaintextHits: readonly PlaintextHit[] = [
    { path: "plaintext-scan-not-completed", needleIndex: 0, offset: 0 },
  ];

  try {
    bindingVersion = await readLoadedBindingVersion();
    const database = await openSqlCipher({ filePath: databasePath, key, mode: "read-write" });
    await database.exec("PRAGMA journal_mode = WAL");
    await database.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, value BLOB NOT NULL)");
    await database.exec(
      `INSERT INTO probe(value) VALUES (X'${sqlHex(UTF8_CANARY)}'), (X'${sqlHex(UTF16_CANARY)}')`,
    );
    const sourceHash = await databaseHash(database);
    await database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    await database.close();

    wrongKeyRejected = await verifyWrongKeyRejected(() =>
      openSqlCipher({ filePath: databasePath, key: randomBytes(32), mode: "read-only" }),
    );

    const utilityCrash = await forceUtilityCrash(root, databasePath, key);
    electronVersion = utilityCrash.electronVersion ?? "unobserved";
    const activeCrashEvidence = await scanCrashArtifactsBeforeRecovery(
      [root],
      [UTF8_CANARY, UTF16_CANARY, CRASH_CANARY],
      async () => {
        const reopened = await openSqlCipher({ filePath: databasePath, key, mode: "read-write" });
        try {
          const integrityRows = await reopened.all<Record<string, unknown>>(
            "PRAGMA cipher_integrity_check",
          );
          const crashRow = await reopened.get<{ count: number }>(
            `SELECT count(*) AS count FROM probe WHERE value = X'${sqlHex(CRASH_CANARY)}'`,
          );
          await reopened.exec("PRAGMA wal_checkpoint(TRUNCATE)");
          return { integrityRows, crashRow };
        } finally {
          await reopened.close();
        }
      },
    );
    const { integrityRows, crashRow } = activeCrashEvidence.recovery;
    crashArtifactsClean =
      utilityCrash.exitedMidTransaction &&
      crashRow?.count === 0 &&
      isCipherIntegrityClean(integrityRows);
    if (process.env.PWM_SQLCIPHER_SPIKE_DEBUG === "1") {
      process.stderr.write(
        `Crash checks: utility=${String(utilityCrash.exitedMidTransaction)} rollback=${String(crashRow?.count === 0)} integrity=${String(integrityRows.length)}\n`,
      );
    }

    await copyFile(databasePath, backupPath);
    await copyFile(backupPath, restoredPath);
    const restored = await openSqlCipher({ filePath: restoredPath, key, mode: "read-only" });
    backupRoundTrip = (await databaseHash(restored)) === sourceHash;
    await restored.close();

    signedPackageLaunch = await buildAndLaunchSignedProbe(root, databasePath, key).catch(() => false);
    const finalPlaintextHits = await findPlaintext(
      [root],
      [UTF8_CANARY, UTF16_CANARY, CRASH_CANARY],
    ).catch(() => [{ path: "plaintext-scan-failed", needleIndex: 0, offset: 0 }]);
    plaintextHits = [...activeCrashEvidence.plaintextHits, ...finalPlaintextHits];
  } finally {
    key.fill(0);
    await rm(root, { force: true, recursive: true });
  }

  return {
    platform: process.platform,
    arch: process.arch,
    electronVersion,
    bindingVersion,
    wrongKeyRejected,
    plaintextHits,
    crashArtifactsClean,
    backupRoundTrip,
    signedPackageLaunch,
  };
}

const reportPath = await writeReport(await runSpike());
process.stdout.write(`${reportPath}\n`);
