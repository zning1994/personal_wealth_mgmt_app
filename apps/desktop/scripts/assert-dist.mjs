import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requiredArtifacts = [
  "out/main/index.js",
  "out/preload/index.js",
  "out/worker/index.js",
  "out/renderer/index.html",
];
const forbiddenRendererLiterals = ["node:fs", "ipcRenderer", "child_process"];
const forbiddenWorkspaceRuntimeSpecifiers = ["@pwm/contracts", "workspace:*"];
const requiredContentSecurityPolicy =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

async function assertRegularFile(relativePath) {
  const artifact = path.join(desktopRoot, relativePath);
  let metadata;
  try {
    metadata = await stat(artifact);
  } catch {
    throw new Error(`Missing required desktop artifact: ${relativePath}`);
  }
  if (!metadata.isFile()) {
    throw new Error(`Desktop artifact is not a regular file: ${relativePath}`);
  }
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(entryPath) : [entryPath];
    }),
  );
  return nested.flat();
}

for (const artifact of requiredArtifacts) {
  await assertRegularFile(artifact);
}

const rendererRoot = path.join(desktopRoot, "out", "renderer");
for (const bundlePath of await filesBelow(rendererRoot)) {
  const bundle = await readFile(bundlePath, "utf8");
  for (const literal of forbiddenRendererLiterals) {
    if (bundle.includes(literal)) {
      throw new Error(
        `Forbidden renderer literal ${JSON.stringify(literal)} found in ${path.relative(desktopRoot, bundlePath)}`,
      );
    }
  }
}

const rendererHtml = await readFile(
  path.join(rendererRoot, "index.html"),
  "utf8",
);
if (!rendererHtml.includes(requiredContentSecurityPolicy)) {
  throw new Error("Renderer Content Security Policy is missing or incomplete");
}

for (const bundlePath of await filesBelow(path.join(desktopRoot, "out"))) {
  const bundle = await readFile(bundlePath, "utf8");
  for (const specifier of forbiddenWorkspaceRuntimeSpecifiers) {
    if (bundle.includes(specifier)) {
      throw new Error(
        `Unbundled workspace runtime specifier ${JSON.stringify(specifier)} found in ${path.relative(desktopRoot, bundlePath)}`,
      );
    }
  }
}

console.log("Desktop distribution smoke gate passed.");
