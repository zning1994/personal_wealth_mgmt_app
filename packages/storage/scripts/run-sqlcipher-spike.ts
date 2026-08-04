import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findPlaintext, type PlaintextHit } from "../src/sqlcipher/plaintext-probe";
import { openSqlCipher } from "../src/sqlcipher/driver";
import {
  isCipherIntegrityClean,
  isOfficialSqlCipher4Version,
  parseElectronCrashMarker,
  readLoadedBindingVersion,
  scanCrashArtifactsBeforeRecovery,
  verifyWrongKeyRejected,
} from "../src/sqlcipher/spike-evidence";
import type { SqlCipherSpikeReport } from "../src/sqlcipher/spike-report";

const require = createRequire(import.meta.url);
const ELECTRON_VERSION = "43.2.0" as const;
const BINDING_NAME = "better-sqlite3-multiple-ciphers" as const;
const UTF8_CANARY = Buffer.from("PWM_SPIKE_账户_¥_884422", "utf8");
const UTF16_CANARY = Buffer.from("PWM_SPIKE_UTF16_账户_884422", "utf16le");
const CRASH_CANARY = Buffer.from("PWM_CRASH_账户_998877", "utf8");

interface CommandResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface CapturedCommandResult extends CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

interface UtilityCrashEvidence {
  readonly exitedMidTransaction: boolean;
  readonly electronVersion: string | undefined;
}

interface PackageEvidence {
  readonly nativeLoaded: boolean;
  readonly signed: boolean;
}

function runCommand(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly inheritStdio?: boolean;
    readonly timeoutMs?: number;
  } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.inheritStdio ? "inherit" : "ignore",
      windowsHide: true,
    });
    const timeout = options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => child.kill(), options.timeoutMs);
    child.once("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (exitCode, signal) => {
      if (timeout) clearTimeout(timeout);
      resolve({ exitCode, signal });
    });
  });
}

function runCapturedCommand(
  command: string,
  args: readonly string[],
  input: string,
): Promise<CapturedCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (exitCode, signal) =>
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
    child.stdin.end(input);
  });
}

function sqlHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

async function databaseHash(connection: Awaited<ReturnType<typeof openSqlCipher>>): Promise<string> {
  const rows = await connection.all<{ id: number; value: string }>(
    "SELECT id, hex(value) AS value FROM probe ORDER BY id",
  );
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function findPackageRoot(moduleEntry: string): Promise<string> {
  let current = path.dirname(moduleEntry);
  while (current !== path.dirname(current)) {
    try {
      const manifest = JSON.parse(await readFile(path.join(current, "package.json"), "utf8")) as {
        name?: unknown;
      };
      if (typeof manifest.name === "string") return current;
    } catch {
      // Continue until the package manifest is reached.
    }
    current = path.dirname(current);
  }
  throw new Error("package-root-not-found");
}

async function prepareElectronNativeApp(root: string): Promise<string | undefined> {
  const appRoot = path.join(root, "electron-native-app");
  const nodeModules = path.join(appRoot, "node_modules");
  await mkdir(nodeModules, { recursive: true, mode: 0o700 });

  for (const packageName of [BINDING_NAME, "bindings", "file-uri-to-path"] as const) {
    const source = await findPackageRoot(require.resolve(packageName));
    const destination = path.join(nodeModules, ...packageName.split("/"));
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await cp(source, destination, { recursive: true, force: true });
  }
  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify({
      name: "pwm-sqlcipher-electron-native",
      version: "0.1.0",
      private: true,
      main: "main.cjs",
      dependencies: {},
    }, null, 2)}\n`,
    { mode: 0o600 },
  );

  const nodeGypCli = require.resolve("node-gyp/bin/node-gyp.js");
  const bindingRoot = path.join(nodeModules, BINDING_NAME);
  const electronGypDevDir =
    process.env.PWM_ELECTRON_GYP_DEVDIR ??
    (process.platform === "darwin"
      ? "/private/tmp/pwm-electron-node-gyp"
      : path.join(tmpdir(), "pwm-electron-node-gyp"));
  const result = await runCommand(
    process.execPath,
    [
      nodeGypCli,
      "rebuild",
      "--release",
      `--target=${ELECTRON_VERSION}`,
      `--arch=${process.arch}`,
      "--dist-url=https://www.electronjs.org/headers",
      `--devdir=${electronGypDevDir}`,
    ],
    {
      cwd: bindingRoot,
      env: {
        ...process.env,
        npm_config_python: process.env.npm_config_python,
        npm_config_devdir: process.env.npm_config_devdir ?? electronGypDevDir,
      },
      inheritStdio: process.env.PWM_SQLCIPHER_SPIKE_DEBUG === "1",
    },
  ).catch(() => ({ exitCode: null, signal: null }));
  return result.exitCode === 0 ? appRoot : undefined;
}

async function forceUtilityCrash(
  root: string,
  electronAppRoot: string,
  databasePath: string,
  key: Uint8Array,
): Promise<UtilityCrashEvidence> {
  const bindingEntry = path.join(electronAppRoot, "node_modules", BINDING_NAME);
  const mainPath = path.join(root, "crash-main.cjs");
  const workerPath = path.join(root, "crash-worker.cjs");
  const markerPath = path.join(root, "crash-transaction-open.marker");

  await writeFile(
    workerPath,
    `const fs = require("node:fs");
try {
  fs.writeFileSync(process.env.PWM_SPIKE_MARKER, JSON.stringify({ state: "binding-loading", electronVersion: process.versions.electron }), { mode: 0o600 });
  const Database = require(${JSON.stringify(bindingEntry)});
  fs.writeFileSync(process.env.PWM_SPIKE_MARKER, JSON.stringify({ state: "binding-loaded", electronVersion: process.versions.electron }), { mode: 0o600 });
  const db = new Database(process.env.PWM_SPIKE_DB, { fileMustExist: true });
  db.pragma("cipher='sqlcipher'");
  db.pragma("legacy=4");
  db.pragma('key="x\\'' + process.env.PWM_SPIKE_KEY + '\\'"');
  db.exec("BEGIN IMMEDIATE");
  db.exec("INSERT INTO probe(value) VALUES (X'${sqlHex(CRASH_CANARY)}')");
  fs.writeFileSync(
    process.env.PWM_SPIKE_MARKER,
    JSON.stringify({ state: "transaction-open", electronVersion: process.versions.electron }),
    { mode: 0o600 },
  );
  process.parentPort.postMessage({ type: "transaction-open" });
  setInterval(() => {}, 1000);
} catch (error) {
  fs.writeFileSync(process.env.PWM_SPIKE_MARKER, JSON.stringify({ state: "failure", electronVersion: process.versions.electron, message: String(error) }), { mode: 0o600 });
  process.parentPort.postMessage({ type: "failure", message: String(error) });
}
`,
    { mode: 0o600 },
  );
  await writeFile(
    mainPath,
    `const { app, utilityProcess } = require("electron");
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(() => {
  const worker = utilityProcess.fork(${JSON.stringify(workerPath)}, [], {
    allowLoadingUnsignedLibraries: true,
    env: {
      PWM_SPIKE_DB: process.env.PWM_SPIKE_DB,
      PWM_SPIKE_KEY: process.env.PWM_SPIKE_KEY,
      PWM_SPIKE_MARKER: process.env.PWM_SPIKE_MARKER,
    },
  });
  let transactionOpened = false;
  const timeout = setTimeout(() => { worker.kill(); app.exit(2); }, 30000);
  worker.on("message", (message) => {
    if (message && message.type === "transaction-open") {
      transactionOpened = true;
      worker.kill();
    }
    if (message && message.type === "failure") {
      console.error("utility-native-failure", message.message);
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
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const electronExecutable = require("electron") as string;
  const result = await runCommand(electronExecutable, [mainPath], {
    env: launchEnvironment,
    inheritStdio: process.env.PWM_SQLCIPHER_SPIKE_DEBUG === "1",
  }).catch(() => ({ exitCode: null, signal: null }));
  const rawMarker = await readFile(markerPath, "utf8").catch(() => "missing");
  if (process.env.PWM_SQLCIPHER_SPIKE_DEBUG === "1") {
    process.stderr.write(
      `Electron utility exit=${String(result.exitCode)} signal=${String(result.signal)} marker=${rawMarker}\n`,
    );
  }
  const marker = parseElectronCrashMarker(rawMarker);
  return {
    exitedMidTransaction: result.exitCode === 0 && marker !== undefined,
    electronVersion: marker?.electronVersion,
  };
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
  return platform === "darwin" && Boolean(
    common &&
      process.env.APPLE_ID &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD &&
      process.env.APPLE_TEAM_ID,
  );
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
  const result = await runCommand(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { env: { ...process.env, PWM_PROBE_EXE: executablePath } },
  );
  return result.exitCode === 0;
}

async function buildAndLaunchProbe(
  root: string,
  electronAppRoot: string,
  databasePath: string,
  key: Uint8Array,
): Promise<PackageEvidence> {
  const outputDir = path.join(root, "probe-package");
  const resultPath = path.join(root, "probe-launch-result.json");
  const signingAvailable = hasRequiredSigningCredentials(process.platform);
  const vendorBindingRoot = path.join(
    electronAppRoot,
    "vendor",
    "better-sqlite3-multiple-ciphers",
  );
  await cp(
    path.join(electronAppRoot, "node_modules", BINDING_NAME),
    vendorBindingRoot,
    { recursive: true, force: true },
  );
  for (const dependency of ["bindings", "file-uri-to-path"] as const) {
    await cp(
      path.join(electronAppRoot, "node_modules", dependency),
      path.join(vendorBindingRoot, "node_modules", dependency),
      { recursive: true, force: true },
    );
  }
  await writeFile(
    path.join(electronAppRoot, "main.cjs"),
    `const { app } = require("electron");
const fs = require("node:fs");
app.commandLine.appendSwitch("disable-gpu");
fs.writeFileSync(process.env.PWM_SPIKE_RESULT, JSON.stringify({ stage: "main-loaded" }));
const timeout = setTimeout(() => app.exit(9), 30000);
app.whenReady().then(() => {
  try {
    fs.writeFileSync(process.env.PWM_SPIKE_RESULT, JSON.stringify({ stage: "app-ready" }));
    const Database = require("./vendor/better-sqlite3-multiple-ciphers");
    fs.writeFileSync(process.env.PWM_SPIKE_RESULT, JSON.stringify({
      stage: "binding-loaded",
      electronVersion: process.versions.electron,
    }));
    const db = new Database(process.env.PWM_SPIKE_DB, { readonly: true, fileMustExist: true });
    db.pragma("cipher='sqlcipher'");
    db.pragma("legacy=4");
    db.pragma('key="x\\'' + process.env.PWM_SPIKE_KEY + '\\'"');
    const row = db.prepare("SELECT count(*) AS count FROM probe").get();
    db.close();
    if (!row || row.count !== 2) { app.exit(4); return; }
    fs.writeFileSync(process.env.PWM_SPIKE_RESULT, JSON.stringify({
      electronVersion: process.versions.electron,
      bindingOpened: true,
    }));
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    fs.writeFileSync(process.env.PWM_SPIKE_RESULT, JSON.stringify({
      stage: "failure",
      electronVersion: process.versions.electron,
      message: String(error),
    }));
    clearTimeout(timeout);
    app.exit(3);
  }
});
`,
    { mode: 0o600 },
  );
  const config = {
    appId: "science.techina.pwm.sqlcipher-probe",
    productName: "PwmSqlCipherProbe",
    electronVersion: ELECTRON_VERSION,
    asar: true,
    asarUnpack: ["vendor/**/better_sqlite3.node"],
    npmRebuild: false,
    forceCodeSigning: signingAvailable,
    directories: { app: electronAppRoot, output: outputDir },
    files: ["package.json", "main.cjs", "vendor/**/*"],
    mac: {
      target: ["dir"],
      hardenedRuntime: true,
      gatekeeperAssess: false,
      notarize: signingAvailable,
      identity: signingAvailable ? undefined : null,
    },
    win: { target: ["dir"], signAndEditExecutable: signingAvailable },
  };
  const configPath = path.join(root, "electron-builder.json");
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const builderCli = require.resolve("electron-builder/out/cli/cli.js");
  const targetArgs = process.platform === "darwin" ? ["--mac", "dir"] : ["--win", "dir"];
  const archArg = process.arch === "arm64" ? "--arm64" : "--x64";
  const buildResult = await runCommand(
    process.execPath,
    [builderCli, "--config", configPath, ...targetArgs, archArg],
    {
      cwd: electronAppRoot,
      env: process.env,
      inheritStdio: process.env.PWM_SQLCIPHER_SPIKE_DEBUG === "1",
    },
  );
  if (process.env.PWM_SQLCIPHER_SPIKE_DEBUG === "1") {
    process.stderr.write(
      `Electron package build exit=${String(buildResult.exitCode)} signal=${String(buildResult.signal)}\n`,
    );
  }
  if (buildResult.exitCode !== 0) return { nativeLoaded: false, signed: false };

  let launchPath: string | undefined;
  let signed = false;
  if (process.platform === "darwin") {
    const appPath = await walkFor(outputDir, (entryPath, directory) =>
      directory && entryPath.endsWith(".app"));
    if (!appPath) return { nativeLoaded: false, signed: false };
    signed = signingAvailable && await verifyMacSignature(appPath);
    launchPath = path.join(appPath, "Contents", "MacOS", "PwmSqlCipherProbe");
  } else {
    launchPath = await walkFor(outputDir, (entryPath, directory) =>
      !directory && path.basename(entryPath) === "PwmSqlCipherProbe.exe");
    if (!launchPath) return { nativeLoaded: false, signed: false };
    signed = signingAvailable && await verifyWindowsSignature(launchPath);
  }
  const launchResult = await runCommand(launchPath, [], {
    env: {
      ...process.env,
      PWM_SPIKE_DB: databasePath,
      PWM_SPIKE_KEY: Buffer.from(key).toString("hex"),
      PWM_SPIKE_RESULT: resultPath,
    },
    timeoutMs: 45_000,
  });
  if (process.env.PWM_SQLCIPHER_SPIKE_DEBUG === "1") {
    process.stderr.write(
      `Electron package launch=${launchPath} exit=${String(launchResult.exitCode)} signal=${String(launchResult.signal)} result=${await readFile(resultPath, "utf8").catch(() => "missing")}\n`,
    );
  }
  if (launchResult.exitCode !== 0) return { nativeLoaded: false, signed };
  const result = JSON.parse(await readFile(resultPath, "utf8")) as Record<string, unknown>;
  return {
    nativeLoaded: result.electronVersion === ELECTRON_VERSION && result.bindingOpened === true,
    signed,
  };
}

async function proveOfficialSqlCipher4Compatibility(
  root: string,
  key: Uint8Array,
): Promise<boolean> {
  const officialCli = process.env.PWM_SQLCIPHER_OFFICIAL_CLI ?? "sqlcipher";
  const version = await runCapturedCommand(officialCli, ["--version"], "").catch(() => undefined);
  if (!version || version.exitCode !== 0) return false;
  if (!isOfficialSqlCipher4Version(
    `${version.stdout}\n${version.stderr}`,
    process.env.PWM_SQLCIPHER_VERSION_PATTERN,
  )) return false;

  const officialDatabase = path.join(root, "official-to-candidate.db");
  const candidateDatabase = path.join(root, "candidate-to-official.db");
  const keyLiteral = `x'${Buffer.from(key).toString("hex")}'`;
  const officialCreate = await runCapturedCommand(
    officialCli,
    [officialDatabase],
    `PRAGMA key="${keyLiteral}";\nPRAGMA cipher_compatibility=4;\nCREATE TABLE fixture(value TEXT NOT NULL);\nINSERT INTO fixture VALUES('official');\n.quit\n`,
  );
  if (officialCreate.exitCode !== 0) return false;
  const candidateRead = await openSqlCipher({ filePath: officialDatabase, key, mode: "read-only" })
    .then(async (database) => {
      try {
        return (await database.get<{ value: string }>("SELECT value FROM fixture"))?.value === "official";
      } finally {
        await database.close();
      }
    })
    .catch(() => false);
  if (!candidateRead) return false;

  const candidate = await openSqlCipher({ filePath: candidateDatabase, key, mode: "read-write" });
  await candidate.exec("CREATE TABLE fixture(value TEXT NOT NULL)");
  await candidate.exec("INSERT INTO fixture VALUES('candidate')");
  await candidate.close();
  const officialRead = await runCapturedCommand(
    officialCli,
    [candidateDatabase],
    `PRAGMA key="${keyLiteral}";\nPRAGMA cipher_compatibility=4;\nSELECT value FROM fixture;\n.quit\n`,
  );
  return officialRead.exitCode === 0 && officialRead.stdout.split(/\r?\n/u).includes("candidate");
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
  let packagedNativeLoad = false;
  let signedPackageLaunch = false;
  let sqlCipher4Compatibility = false;
  let electronVersion = "unobserved";
  let bindingVersion = "unobserved";
  let plaintextHits: readonly PlaintextHit[] = [
    { path: "plaintext-scan-not-completed", needleIndex: 0, offset: 0 },
  ];

  try {
    bindingVersion = await readLoadedBindingVersion();
    const database = await openSqlCipher({ filePath: databasePath, key, mode: "read-write" });
    await database.exec("PRAGMA journal_mode=WAL");
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

    const electronAppRoot = await prepareElectronNativeApp(root);
    const utilityCrash = electronAppRoot
      ? await forceUtilityCrash(root, electronAppRoot, databasePath, key)
      : { exitedMidTransaction: false, electronVersion: undefined };
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
            `SELECT count(*) AS count FROM probe WHERE value=X'${sqlHex(CRASH_CANARY)}'`,
          );
          await reopened.exec("PRAGMA wal_checkpoint(TRUNCATE)");
          return { integrityRows, crashRow };
        } finally {
          await reopened.close();
        }
      },
    );
    crashArtifactsClean =
      utilityCrash.exitedMidTransaction &&
      activeCrashEvidence.recovery.crashRow?.count === 0 &&
      isCipherIntegrityClean(activeCrashEvidence.recovery.integrityRows);

    await copyFile(databasePath, backupPath);
    await copyFile(backupPath, restoredPath);
    const restored = await openSqlCipher({ filePath: restoredPath, key, mode: "read-only" });
    backupRoundTrip = (await databaseHash(restored)) === sourceHash;
    await restored.close();

    sqlCipher4Compatibility = await proveOfficialSqlCipher4Compatibility(root, key);
    if (electronAppRoot) {
      const packageEvidence = await buildAndLaunchProbe(
        root,
        electronAppRoot,
        databasePath,
        key,
      ).catch(() => ({ nativeLoaded: false, signed: false }));
      packagedNativeLoad = packageEvidence.nativeLoaded;
      signedPackageLaunch = packageEvidence.nativeLoaded && packageEvidence.signed;
      if (process.env.PWM_SQLCIPHER_SPIKE_DEBUG === "1") {
        process.stderr.write(
          `Electron package nativeLoaded=${String(packageEvidence.nativeLoaded)} signed=${String(packageEvidence.signed)}\n`,
        );
      }
    }
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
    cipherImplementation: BINDING_NAME,
    cipherMode: "sqlcipher-legacy-4",
    wrongKeyRejected,
    plaintextHits,
    crashArtifactsClean,
    backupRoundTrip,
    packagedNativeLoad,
    sqlCipher4Compatibility,
    signedPackageLaunch,
  };
}

const reportPath = await writeReport(await runSpike());
process.stdout.write(`${reportPath}\n`);
