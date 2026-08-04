import path from "node:path";
import { describe, expect, it } from "vitest";
import { packagedExecutableCandidates } from "./packaged-app.mjs";

describe("packaged executable resolution", () => {
  it("covers both electron-builder mac directory layouts for the current architecture", () => {
    expect(packagedExecutableCandidates("/desktop", "darwin", "arm64")).toEqual([
      path.join("/desktop", "release", "mac-arm64", "Personal Wealth.app", "Contents", "MacOS", "Personal Wealth"),
      path.join("/desktop", "release", "mac", "Personal Wealth.app", "Contents", "MacOS", "Personal Wealth"),
    ]);
    expect(packagedExecutableCandidates("/desktop", "darwin", "x64")[0]).toContain("mac-x64");
  });

  it("resolves the Windows unpacked executable contract", () => {
    expect(packagedExecutableCandidates("C:\\desktop", "win32", "x64")).toEqual([
      path.win32.join("C:\\desktop", "release", "win-unpacked", "Personal Wealth.exe"),
    ]);
  });

  it("rejects unsupported packaged hosts", () => {
    expect(() => packagedExecutableCandidates("/desktop", "linux", "x64")).toThrow(
      "Packaged smoke supports macOS and Windows",
    );
  });
});
