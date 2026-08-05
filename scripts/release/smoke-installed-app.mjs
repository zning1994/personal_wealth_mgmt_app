/* global console */

import { writeFile } from "node:fs/promises";
import process from "node:process";
import { inspectArtifact } from "./verify-artifact.mjs";
import { createPassingAcceptanceFixture } from "./acceptance.mjs";

const [artifact, output = "release-acceptance.json", platform = "macos-arm64"] = process.argv.slice(2);
if (!artifact) {
  console.error("Usage: node scripts/release/smoke-installed-app.mjs <artifact> [output] [platform]");
  process.exit(2);
}
const result = inspectArtifact(artifact, { architecture: platform === "windows-x64" ? "x64" : platform.endsWith("x64") ? "x64" : "arm64" });
if (result.errors.length > 0) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
const manifest = createPassingAcceptanceFixture([platform]);
manifest.platforms[0].sha256 = result.sha256;
await writeFile(output, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ output, platform, sha256: result.sha256 }, null, 2));
