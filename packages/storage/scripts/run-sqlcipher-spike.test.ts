import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { parseSpikeReport } from "../src/sqlcipher/spike-report";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

describe("SQLCipher executable spike", () => {
  it("crashes an Electron utility process mid-transaction without corrupting the database", async () => {
    const temporaryRootsBefore = (await readdir(tmpdir()))
      .filter((name) => name.startsWith("pwm-sqlcipher-spike-"))
      .sort();
    const environment = { ...process.env };
    for (const name of [
      "CSC_LINK",
      "CSC_KEY_PASSWORD",
      "APPLE_ID",
      "APPLE_APP_SPECIFIC_PASSWORD",
      "APPLE_TEAM_ID",
    ]) {
      delete environment[name];
    }

    await execFileAsync(process.execPath, [require.resolve("tsx/cli"), "scripts/run-sqlcipher-spike.ts"], {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: environment,
      timeout: 30_000,
    });

    const report = parseSpikeReport(
      JSON.parse(
        await readFile(
          path.resolve(
            import.meta.dirname,
            "../../../artifacts/sqlcipher-spike",
            `${process.platform}-${process.arch}.json`,
          ),
          "utf8",
        ),
      ),
    );
    expect(report.wrongKeyRejected).toBe(true);
    expect(report.plaintextHits).toEqual([]);
    expect(report.crashArtifactsClean).toBe(true);
    expect(report.backupRoundTrip).toBe(true);
    expect(
      (await readdir(tmpdir()))
        .filter((name) => name.startsWith("pwm-sqlcipher-spike-"))
        .sort(),
    ).toEqual(temporaryRootsBefore);
  });
});
