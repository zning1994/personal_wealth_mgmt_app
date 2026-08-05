/* global console */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";

const FORBIDDEN_PATHS = [
  /(^|\/)\.env(?:\.|$)/i,
  /\.(?:pem|p12|pfx|key)$/i,
  /(^|\/)workspace\.db(?:-|$)/i,
  /(^|\/)source-objects(?:\/|$)/i,
  /(^|\/)fixtures\/real(?:\/|$)/i,
];

function walk(root, current = root, result = []) {
  if (!existsSync(current)) return result;
  const stat = lstatSync(current);
  if (stat.isSymbolicLink()) {
    result.push({ path: relative(root, current), type: "symlink" });
    return result;
  }
  if (stat.isDirectory()) {
    for (const entry of readdirSync(current)) walk(root, join(current, entry), result);
    return result;
  }
  result.push({ path: relative(root, current), type: "file", bytes: stat.size });
  return result;
}

function detectArchitecture(root) {
  const packageJson = join(root, "resources", "app", "package.json");
  if (existsSync(packageJson)) {
    try {
      const parsed = JSON.parse(readFileSync(packageJson, "utf8"));
      if (typeof parsed.architecture === "string") return parsed.architecture;
    } catch {
      // The caller receives a structured invalid-manifest error below.
    }
  }
  const marker = join(root, "artifact-manifest.json");
  if (existsSync(marker)) {
    try {
      const parsed = JSON.parse(readFileSync(marker, "utf8"));
      if (typeof parsed.architecture === "string") return parsed.architecture;
    } catch {
      // Ignore malformed optional marker; the inspector remains fail-closed.
    }
  }
  return undefined;
}

export function inspectArtifact(inputPath, expected = {}) {
  const root = resolve(inputPath);
  const errors = [];
  const files = [];
  if (!existsSync(root)) {
    errors.push({ code: "MISSING_ARTIFACT", path: root });
    return { path: root, architecture: undefined, files, errors, sha256: undefined };
  }
  files.push(...walk(root));
  for (const entry of files) {
    if (entry.type === "symlink") {
      errors.push({ code: "SYMLINK_NOT_ALLOWED", path: entry.path });
    }
    if (FORBIDDEN_PATHS.some((pattern) => pattern.test(entry.path))) {
      errors.push({ code: "SENSITIVE_FILE", path: entry.path });
    }
  }
  const architecture = detectArchitecture(root);
  if (expected.architecture && architecture && expected.architecture !== architecture) {
    errors.push({ code: "ARCH_MISMATCH", expected: expected.architecture, actual: architecture });
  }
  if (expected.architecture && !architecture) {
    errors.push({ code: "ARCHITECTURE_UNDECLARED", expected: expected.architecture });
  }
  const hash = createHash("sha256");
  for (const entry of files.filter((item) => item.type === "file").sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(entry.path);
    hash.update(String(entry.bytes));
    hash.update(readFileSync(join(root, entry.path)));
  }
  return { path: root, architecture, files, errors, sha256: hash.digest("hex") };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [artifact, architecture] = process.argv.slice(2);
  if (!artifact) {
    console.error("Usage: node scripts/release/verify-artifact.mjs <artifact-dir> [architecture]");
    process.exitCode = 2;
  } else {
    const result = inspectArtifact(artifact, architecture ? { architecture } : {});
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length > 0) process.exitCode = 1;
  }
}
