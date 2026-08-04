import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import { assertDistribution } from "./assert-distribution.mjs";

const requiredContentSecurityPolicy =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const fixtures = [];

function fixtureRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "pwm-distribution-"));
  fixtures.push(root);
  return root;
}

function writeFixture(root, relativePath, contents) {
  const pathname = path.join(root, relativePath);
  mkdirSync(path.dirname(pathname), { recursive: true });
  writeFileSync(pathname, contents);
  return pathname;
}

function validDistribution(options = {}) {
  const root = fixtureRoot();
  const omitted = new Set(options.omit ?? []);
  const files = {
    "out/main/index.js": "console.log('main')",
    "out/preload/index.js": "console.log('preload')",
    "out/worker/index.js": "console.log('worker')",
    "out/ocr/index.js": "console.log('ocr')",
    "out/renderer/index.html": `<meta http-equiv="Content-Security-Policy" content="${requiredContentSecurityPolicy}">`,
    "out/renderer/assets/app.js": "console.log('renderer')",
  };
  for (const [relativePath, contents] of Object.entries(files)) {
    if (!omitted.has(relativePath)) writeFixture(root, relativePath, contents);
  }
  return root;
}

function symlinkUnavailable(error) {
  return ["EPERM", "EACCES", "ENOSYS"].includes(error.code);
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("distribution assertions", () => {
  it("accepts a complete safe distribution", async () => {
    await expect(
      assertDistribution(validDistribution()),
    ).resolves.toBeUndefined();
  });

  it("rejects a missing required artifact", async () => {
    const root = validDistribution({ omit: ["out/worker/index.js"] });
    await expect(assertDistribution(root)).rejects.toThrow(
      "Missing required desktop artifact: out/worker/index.js",
    );
  });

  it("rejects a missing OCR worker artifact", async () => {
    const root = validDistribution({ omit: ["out/ocr/index.js"] });
    await expect(assertDistribution(root)).rejects.toThrow(
      "Missing required desktop artifact: out/ocr/index.js",
    );
  });

  it("rejects a forbidden renderer literal", async () => {
    const root = validDistribution();
    writeFixture(root, "out/renderer/assets/app.js", "require('node:fs')");
    await expect(assertDistribution(root)).rejects.toThrow(
      'Forbidden renderer literal "node:fs"',
    );
  });

  it.each([
    ["missing", "<html></html>"],
    ["incomplete", "<meta content=\"default-src 'self'\">"],
  ])("rejects a %s renderer CSP", async (_case, html) => {
    const root = validDistribution();
    writeFixture(root, "out/renderer/index.html", html);
    await expect(assertDistribution(root)).rejects.toThrow(
      "Renderer Content Security Policy is missing or incomplete",
    );
  });

  it("rejects an unbundled workspace runtime specifier", async () => {
    const root = validDistribution();
    writeFixture(root, "out/main/index.js", "import '@pwm/contracts'");
    await expect(assertDistribution(root)).rejects.toThrow(
      'Unbundled workspace runtime specifier "@pwm/contracts"',
    );
  });

  it("rejects a symlink used as a required artifact", async (context) => {
    const root = validDistribution({ omit: ["out/main/index.js"] });
    const target = writeFixture(root, "outside/main.js", "outside");
    const link = path.join(root, "out/main/index.js");
    mkdirSync(path.dirname(link), { recursive: true });
    try {
      symlinkSync(target, link, "file");
    } catch (error) {
      if (!symlinkUnavailable(error)) throw error;
      context.skip(`file symlink unavailable: ${error.code}`);
      return;
    }
    await expect(assertDistribution(root)).rejects.toThrow("symbolic link");
  });

  it("rejects a nested file symlink", async (context) => {
    const root = validDistribution();
    const target = writeFixture(root, "outside/asset.js", "outside");
    const link = path.join(root, "out/renderer/assets/linked.js");
    try {
      symlinkSync(target, link, "file");
    } catch (error) {
      if (!symlinkUnavailable(error)) throw error;
      context.skip(`file symlink unavailable: ${error.code}`);
      return;
    }
    await expect(assertDistribution(root)).rejects.toThrow("symbolic link");
  });

  it("rejects a nested directory symlink", async (context) => {
    const root = validDistribution();
    const target = path.join(root, "outside/assets");
    mkdirSync(target, { recursive: true });
    const link = path.join(root, "out/renderer/linked-assets");
    try {
      symlinkSync(
        target,
        link,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (!symlinkUnavailable(error)) throw error;
      context.skip(`directory symlink unavailable: ${error.code}`);
      return;
    }
    await expect(assertDistribution(root)).rejects.toThrow("symbolic link");
  });
});
