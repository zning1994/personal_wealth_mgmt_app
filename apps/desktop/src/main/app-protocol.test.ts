import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  installApplicationProtocol,
  isApplicationAssetFileUrl,
  registerApplicationProtocolScheme,
  resolveCanonicalRendererAsset,
  resolveRendererAsset,
} from "./app-protocol";

const fixtureRoot = mkdtempSync(path.join(tmpdir(), "pwm-app-protocol-"));
const rendererRoot = path.join(fixtureRoot, "renderer");
const outsideRoot = path.join(fixtureRoot, "outside");
mkdirSync(path.join(rendererRoot, "assets"), { recursive: true });
mkdirSync(outsideRoot, { recursive: true });
writeFileSync(path.join(rendererRoot, "index.html"), "ok");
writeFileSync(path.join(rendererRoot, "assets", "app.js"), "ok");
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

  it("resolves existing regular assets through their canonical path", () => {
    expect(
      resolveCanonicalRendererAsset("app://desktop/index.html", rendererRoot),
    ).toBe(realpathSync(path.join(rendererRoot, "index.html")));
    expect(() =>
      resolveCanonicalRendererAsset(
        "app://desktop/assets/missing.js",
        rendererRoot,
      ),
    ).toThrow("Application asset URL is not allowed");
  });

  const symlinkIt = fileSymlinkSkipReason === undefined ? it : it.skip;
  symlinkIt(
    fileSymlinkSkipReason === undefined
      ? "rejects a renderer symlink that escapes the canonical root"
      : `rejects a renderer symlink that escapes the canonical root (symlink unavailable: ${fileSymlinkSkipReason})`,
    () => {
      expect(() =>
        resolveCanonicalRendererAsset(
          "app://desktop/assets/escape.js",
          rendererRoot,
        ),
      ).toThrow("Application asset URL is not allowed");
    },
  );

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

  it("installs a file-backed handler that reuses strict URL containment", async () => {
    const response = new Response("ok");
    fetch.mockResolvedValue(response);

    installApplicationProtocol(rendererRoot);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith("app", expect.any(Function));
    const handler = handle.mock.calls[0]?.[1] as (request: {
      url: string;
    }) => Promise<Response>;
    await expect(handler({ url: "app://desktop/index.html" })).resolves.toBe(
      response,
    );
    expect(fetch).toHaveBeenCalledWith(
      pathToFileURL(
        realpathSync(path.join(rendererRoot, "index.html")),
      ).toString(),
    );
    expect(
      isApplicationAssetFileUrl(
        pathToFileURL(path.join(rendererRoot, "assets", "app.js")).toString(),
      ),
    ).toBe(true);
    expect(
      isApplicationAssetFileUrl(
        pathToFileURL(path.join(outsideRoot, "secret.js")).toString(),
      ),
    ).toBe(false);
    expect(
      isApplicationAssetFileUrl(
        pathToFileURL(
          path.join(rendererRoot, "assets", "missing.js"),
        ).toString(),
      ),
    ).toBe(false);
    if (fileSymlinkSkipReason === undefined) {
      expect(
        isApplicationAssetFileUrl(pathToFileURL(escapeLink).toString()),
      ).toBe(false);
      await expect(
        handler({ url: "app://desktop/assets/escape.js" }),
      ).rejects.toThrow("Application asset URL is not allowed");
    }
    expect(isApplicationAssetFileUrl("https://example.com/app.js")).toBe(false);
    await expect(
      handler({ url: "app://desktop/../main/index.js" }),
    ).rejects.toThrow("Application asset URL is not allowed");
  });
});
