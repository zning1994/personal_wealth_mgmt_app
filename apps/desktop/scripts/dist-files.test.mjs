import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assertRegularFile, filesBelow } from "./dist-files.mjs";

const fixtureRoot = mkdtempSync(path.join(tmpdir(), "pwm-dist-files-"));
const outputRoot = path.join(fixtureRoot, "out");
const nestedRoot = path.join(outputRoot, "renderer", "assets");
mkdirSync(nestedRoot, { recursive: true });
const entryFile = path.join(outputRoot, "renderer", "index.html");
const nestedFile = path.join(nestedRoot, "app.js");
writeFileSync(entryFile, "ok");
writeFileSync(nestedFile, "ok");

const cleanRoot = path.join(fixtureRoot, "clean");
const cleanNestedRoot = path.join(cleanRoot, "assets");
mkdirSync(cleanNestedRoot, { recursive: true });
const cleanEntryFile = path.join(cleanRoot, "index.html");
const cleanNestedFile = path.join(cleanNestedRoot, "app.js");
writeFileSync(cleanEntryFile, "ok");
writeFileSync(cleanNestedFile, "ok");

const fileLink = path.join(nestedRoot, "linked.js");
let fileSymlinkSkipReason;
try {
  symlinkSync(nestedFile, fileLink, "file");
} catch (error) {
  if (!["EPERM", "EACCES", "ENOSYS"].includes(error.code)) throw error;
  fileSymlinkSkipReason = error.code;
}

const directoryCaseRoot = path.join(fixtureRoot, "directory-case");
const directoryTargetRoot = path.join(fixtureRoot, "directory-target");
mkdirSync(directoryCaseRoot, { recursive: true });
mkdirSync(directoryTargetRoot, { recursive: true });
writeFileSync(path.join(directoryTargetRoot, "external.js"), "outside");
const directoryLink = path.join(directoryCaseRoot, "linked-renderer");
let directorySymlinkSkipReason;
try {
  symlinkSync(
    directoryTargetRoot,
    directoryLink,
    process.platform === "win32" ? "junction" : "dir",
  );
} catch (error) {
  if (!["EPERM", "EACCES", "ENOSYS"].includes(error.code)) throw error;
  directorySymlinkSkipReason = error.code;
}

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("distribution filesystem assertions", () => {
  it("accepts only regular required artifacts and recursively lists regular files", async () => {
    await expect(
      assertRegularFile(cleanEntryFile, "renderer/index.html"),
    ).resolves.toBeUndefined();
    await expect(filesBelow(cleanRoot)).resolves.toEqual(
      expect.arrayContaining([cleanEntryFile, cleanNestedFile]),
    );
    await expect(
      assertRegularFile(cleanRoot, "renderer/index.html"),
    ).rejects.toThrow("not a regular file");
  });

  const fileSymlinkIt = fileSymlinkSkipReason === undefined ? it : it.skip;
  fileSymlinkIt(
    fileSymlinkSkipReason === undefined
      ? "rejects a symlinked file"
      : `rejects a symlinked file (symlink unavailable: ${fileSymlinkSkipReason})`,
    async () => {
      await expect(
        assertRegularFile(fileLink, "renderer/linked.js"),
      ).rejects.toThrow("symbolic link");
      await expect(
        filesBelow(path.join(outputRoot, "renderer")),
      ).rejects.toThrow("symbolic link");
    },
  );

  const directorySymlinkIt =
    directorySymlinkSkipReason === undefined ? it : it.skip;
  directorySymlinkIt(
    directorySymlinkSkipReason === undefined
      ? "rejects a symlinked directory"
      : `rejects a symlinked directory (symlink unavailable: ${directorySymlinkSkipReason})`,
    async () => {
      await expect(filesBelow(directoryCaseRoot)).rejects.toThrow(
        "symbolic link",
      );
    },
  );
});
