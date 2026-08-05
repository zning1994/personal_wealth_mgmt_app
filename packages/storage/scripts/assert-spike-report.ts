import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSpikeReport,
  parseSpikeReport,
  type ExpectedSpikeRunner,
} from "../src/sqlcipher/spike-report";

function expectedRunner(): ExpectedSpikeRunner {
  const platform = process.env.PWM_EXPECTED_PLATFORM ?? process.platform;
  const arch = process.env.PWM_EXPECTED_ARCH ?? process.arch;
  if ((platform !== "darwin" && platform !== "win32") || (arch !== "arm64" && arch !== "x64")) {
    throw new Error("invalid-expected-sqlcipher-runner");
  }
  return { platform, arch };
}

function requireSignedPackageLaunch(): boolean {
  const value = process.env.PWM_REQUIRE_SIGNED_PACKAGE ?? "true";
  if (value !== "true" && value !== "false") {
    throw new Error("invalid-require-signed-package-setting");
  }
  return value === "true";
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const runner = expectedRunner();
const reportPath =
  process.env.PWM_SQLCIPHER_SPIKE_REPORT ??
  path.join(repositoryRoot, "artifacts", "sqlcipher-spike", `${runner.platform}-${runner.arch}.json`);
const report = parseSpikeReport(JSON.parse(await readFile(reportPath, "utf8")));
assertSpikeReport(report, runner, { requireSignedPackageLaunch: requireSignedPackageLaunch() });
process.stdout.write(`SQLCipher spike gate passed for ${runner.platform}-${runner.arch}.\n`);
