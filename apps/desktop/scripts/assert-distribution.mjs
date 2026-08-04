import path from "node:path";
import { readFilesBelow } from "./dist-files.mjs";

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

export async function assertDistribution(desktopRoot) {
  const files = await readFilesBelow(path.join(desktopRoot, "out"), "out");
  const filesByLabel = new Map(files.map((file) => [file.label, file]));

  for (const artifact of requiredArtifacts) {
    if (!filesByLabel.has(artifact)) {
      throw new Error(`Missing required desktop artifact: ${artifact}`);
    }
  }

  for (const file of files) {
    const bundle = file.contents.toString("utf8");
    if (file.label.startsWith("out/renderer/")) {
      for (const literal of forbiddenRendererLiterals) {
        if (bundle.includes(literal)) {
          throw new Error(
            `Forbidden renderer literal ${JSON.stringify(literal)} found in ${file.label}`,
          );
        }
      }
    }

    for (const specifier of forbiddenWorkspaceRuntimeSpecifiers) {
      if (bundle.includes(specifier)) {
        throw new Error(
          `Unbundled workspace runtime specifier ${JSON.stringify(specifier)} found in ${file.label}`,
        );
      }
    }
  }

  const rendererHtml = filesByLabel
    .get("out/renderer/index.html")
    ?.contents.toString("utf8");
  if (!rendererHtml?.includes(requiredContentSecurityPolicy)) {
    throw new Error(
      "Renderer Content Security Policy is missing or incomplete",
    );
  }
}
