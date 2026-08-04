import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { registerSchemesAsPrivileged, handle, fetch } = vi.hoisted(() => ({
  registerSchemesAsPrivileged: vi.fn(),
  handle: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("electron", () => ({
  protocol: { registerSchemesAsPrivileged, handle },
  net: { fetch },
}));

import {
  asarArchivePath,
  contentTypeForAsset,
  installApplicationProtocol,
  readVerifiedRendererAsset,
  registerApplicationProtocolScheme,
  resolveRendererAsset,
} from "./app-protocol";

const fixtureRoot = mkdtempSync(path.join(tmpdir(), "pwm-app-protocol-"));
const rendererRoot = path.join(fixtureRoot, "renderer");
const outsideRoot = path.join(fixtureRoot, "outside");
mkdirSync(path.join(rendererRoot, "assets"), { recursive: true });
mkdirSync(outsideRoot, { recursive: true });
writeFileSync(path.join(rendererRoot, "index.html"), "ok");
writeFileSync(path.join(rendererRoot, "assets", "app.js"), "ok");
writeFileSync(path.join(rendererRoot, "assets", "app.css"), "ok");
writeFileSync(path.join(rendererRoot, "assets", "data.json"), "{}");
writeFileSync(path.join(rendererRoot, "assets", "unknown.bin"), "binary");
writeFileSync(path.join(outsideRoot, "secret.js"), "secret");

const escapeLink = path.join(rendererRoot, "assets", "escape.js");
let fileSymlinkSkipReason: string | undefined;
try {
  symlinkSync(path.join(outsideRoot, "secret.js"), escapeLink, "file");
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== "EPERM" && code !== "EACCES" && code !== "ENOSYS") throw error;
  fileSymlinkSkipReason = code;
}

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("app protocol", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves only desktop-host assets below a POSIX renderer root", () => {
    const root = "/repo/apps/desktop/out/renderer";

    expect(resolveRendererAsset("app://desktop/index.html", root)).toBe(
      `${root}/index.html`,
    );
    expect(resolveRendererAsset("app://desktop/", root)).toBe(
      `${root}/index.html`,
    );
    expect(resolveRendererAsset("app://desktop/assets/app.js", root)).toBe(
      `${root}/assets/app.js`,
    );
  });

  it.each([
    "app://desktop/../main/index.js",
    "app://desktop/%2e%2e/main/index.js",
    "app://desktop/%252e%252e/main/index.js",
    "app://desktop/assets%2f..%2fmain/index.js",
    "app://desktop/assets\\..\\main\\index.js",
    "app://desktop/assets%5c..%5cmain%5cindex.js",
    "app://desktop/C:/Windows/System32/config",
  ])("rejects traversal or platform-path input: %s", (url) => {
    expect(() =>
      resolveRendererAsset(url, "/repo/apps/desktop/out/renderer"),
    ).toThrow("Application asset URL is not allowed");
  });

  it.each([
    "app://other/index.html",
    "app://desktop.evil/index.html",
    "app://desktop:443/index.html",
    "app://user@desktop/index.html",
    "https://desktop/index.html",
    "app://desktop/index.html?source=remote",
    "app://desktop/index.html#fragment",
  ])(
    "rejects non-canonical scheme, authority, query, or hash boundaries: %s",
    (url) => {
      expect(() =>
        resolveRendererAsset(url, "/repo/apps/desktop/out/renderer"),
      ).toThrow("Application asset URL is not allowed");
    },
  );

  it("uses Windows containment rules for a Windows renderer root", () => {
    const root = "C:\\repo\\apps\\desktop\\out\\renderer";

    expect(resolveRendererAsset("app://desktop/assets/app.js", root)).toBe(
      "C:\\repo\\apps\\desktop\\out\\renderer\\assets\\app.js",
    );
    expect(() =>
      resolveRendererAsset("app://desktop/D:/escape.txt", root),
    ).toThrow("Application asset URL is not allowed");
  });

  it("requires an absolute renderer root", () => {
    expect(() =>
      resolveRendererAsset("app://desktop/index.html", "out/renderer"),
    ).toThrow("Renderer root must be absolute");
  });

  it.each([
    [
      "/Applications/Personal Wealth.app/Contents/Resources/app.asar/out/renderer/index.html",
      "/Applications/Personal Wealth.app/Contents/Resources/app.asar",
    ],
    [
      "C:\\Program Files\\Personal Wealth\\resources\\app.asar\\out\\renderer\\index.html",
      "C:\\Program Files\\Personal Wealth\\resources\\app.asar",
    ],
    ["/repo/apps/desktop/out/renderer/index.html", undefined],
    ["/repo/app.asar.unpacked/renderer/index.html", undefined],
  ])("finds the containing ASAR archive for %s", (assetPath, expected) => {
    expect(asarArchivePath(assetPath)).toBe(expected);
  });

  it("reads an existing regular asset from its verified file handle", async () => {
    const asset = await readVerifiedRendererAsset(
      "app://desktop/index.html",
      rendererRoot,
    );
    expect(Buffer.from(asset.body).toString("utf8")).toBe("ok");
    expect(asset.contentType).toBe("text/html; charset=utf-8");
    await expect(
      readVerifiedRendererAsset(
        "app://desktop/assets/missing.js",
        rendererRoot,
      ),
    ).rejects.toThrow("Application asset URL is not allowed");
  });

  const symlinkIt = fileSymlinkSkipReason === undefined ? it : it.skip;
  symlinkIt(
    fileSymlinkSkipReason === undefined
      ? "rejects a renderer symlink that escapes the canonical root"
      : `rejects a renderer symlink that escapes the canonical root (symlink unavailable: ${fileSymlinkSkipReason})`,
    async () => {
      await expect(
        readVerifiedRendererAsset(
          "app://desktop/assets/escape.js",
          rendererRoot,
        ),
      ).rejects.toThrow("Application asset URL is not allowed");
    },
  );

  it.each([
    ["index.html", "text/html; charset=utf-8"],
    ["app.js", "text/javascript; charset=utf-8"],
    ["app.css", "text/css; charset=utf-8"],
    ["data.json", "application/json; charset=utf-8"],
    ["icon.svg", "image/svg+xml"],
    ["icon.png", "image/png"],
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["photo.webp", "image/webp"],
    ["font.woff", "font/woff"],
    ["font.woff2", "font/woff2"],
    ["unknown.bin", "application/octet-stream"],
  ])("maps %s to %s", (filename, expected) => {
    expect(contentTypeForAsset(filename)).toBe(expected);
  });

  it("registers the app scheme with the exact privileged surface", () => {
    registerApplicationProtocolScheme();

    expect(registerSchemesAsPrivileged).toHaveBeenCalledOnce();
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: "app",
        privileges: { standard: true, secure: true, supportFetchAPI: true },
      },
    ]);
  });

  it("serves a Response from verified bytes without issuing a file request", async () => {
    installApplicationProtocol(rendererRoot);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith("app", expect.any(Function));
    const handler = handle.mock.calls[0]?.[1] as (request: {
      url: string;
    }) => Promise<Response>;
    const response = await handler({ url: "app://desktop/index.html" });
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(fetch).not.toHaveBeenCalled();
    if (fileSymlinkSkipReason === undefined) {
      await expect(
        handler({ url: "app://desktop/assets/escape.js" }),
      ).rejects.toThrow("Application asset URL is not allowed");
    }
    await expect(
      handler({ url: "app://desktop/../main/index.js" }),
    ).rejects.toThrow("Application asset URL is not allowed");
  });
});
