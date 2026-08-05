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
  closeAssetHandles,
  contentTypeForAsset,
  findPhysicalAsarArchive,
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
    {
      name: "POSIX parent directory named .asar",
      assetPath: "/repo/cache.asar/out/renderer/index.html",
      entries: { "/repo/cache.asar": "directory" },
      expected: undefined,
    },
    {
      name: "POSIX multiple .asar segments",
      assetPath: "/repo/cache.asar/build/app.asar/out/renderer/index.html",
      entries: {
        "/repo/cache.asar": "directory",
        "/repo/cache.asar/build/app.asar": "file",
      },
      expected: "/repo/cache.asar/build/app.asar",
    },
    {
      name: "POSIX physical archive",
      assetPath:
        "/Applications/Personal Wealth.app/resources/app.asar/out/index.html",
      entries: {
        "/Applications/Personal Wealth.app/resources/app.asar": "file",
      },
      expected: "/Applications/Personal Wealth.app/resources/app.asar",
    },
    {
      name: "POSIX no archive candidate",
      assetPath: "/repo/apps/desktop/out/renderer/index.html",
      entries: {},
      expected: undefined,
    },
    {
      name: "Windows parent directory named .asar",
      assetPath: "C:\\repo\\cache.asar\\out\\renderer\\index.html",
      entries: { "C:\\repo\\cache.asar": "directory" },
      expected: undefined,
    },
    {
      name: "Windows multiple .asar segments",
      assetPath:
        "C:\\repo\\cache.asar\\build\\app.asar\\out\\renderer\\index.html",
      entries: {
        "C:\\repo\\cache.asar": "directory",
        "C:\\repo\\cache.asar\\build\\app.asar": "file",
      },
      expected: "C:\\repo\\cache.asar\\build\\app.asar",
    },
    {
      name: "Windows physical archive after a symlink candidate",
      assetPath:
        "C:\\repo\\linked.asar\\build\\app.asar\\out\\renderer\\index.html",
      entries: {
        "C:\\repo\\linked.asar": "symlink",
        "C:\\repo\\linked.asar\\build\\app.asar": "file",
      },
      expected: "C:\\repo\\linked.asar\\build\\app.asar",
    },
    {
      name: "Windows physical archive",
      assetPath:
        "C:\\Program Files\\Personal Wealth\\resources\\app.asar\\out\\index.html",
      entries: {
        "C:\\Program Files\\Personal Wealth\\resources\\app.asar": "file",
      },
      expected: "C:\\Program Files\\Personal Wealth\\resources\\app.asar",
    },
    {
      name: "Windows no archive candidate",
      assetPath: "C:\\repo\\apps\\desktop\\out\\renderer\\index.html",
      entries: {},
      expected: undefined,
    },
  ])(
    "selects only a physical archive: $name",
    async ({ assetPath, entries, expected }) => {
      const physicalLstat = vi.fn(async (candidate: string) => {
        const kind = entries[candidate as keyof typeof entries];
        if (kind === undefined) {
          const error = new Error("not found") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        return {
          isFile: () => kind === "file",
          isSymbolicLink: () => kind === "symlink",
        };
      });

      await expect(
        findPhysicalAsarArchive(assetPath, physicalLstat as never),
      ).resolves.toBe(expected);
      if (!assetPath.toLowerCase().includes(".asar")) {
        expect(physicalLstat).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ["asset close failure", true, false],
    ["archive close failure", false, true],
    ["both close failures", true, true],
  ])(
    "closes both handles and masks %s",
    async (_name, assetFails, archiveFails) => {
      const assetHandle = {
        close: vi
          .fn()
          .mockImplementation(() =>
            assetFails
              ? Promise.reject(new Error("asset close detail"))
              : Promise.resolve(),
          ),
      };
      const archiveHandle = {
        close: vi
          .fn()
          .mockImplementation(() =>
            archiveFails
              ? Promise.reject(new Error("archive close detail"))
              : Promise.resolve(),
          ),
      };

      await expect(
        closeAssetHandles(assetHandle, archiveHandle),
      ).rejects.toThrow("Application asset URL is not allowed");
      expect(assetHandle.close).toHaveBeenCalledOnce();
      expect(archiveHandle.close).toHaveBeenCalledOnce();
    },
  );

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

  it("treats a physical .asar directory as an ordinary development path", async () => {
    const developmentRoot = path.join(fixtureRoot, "cache.asar", "renderer");
    mkdirSync(developmentRoot, { recursive: true });
    writeFileSync(path.join(developmentRoot, "index.html"), "development");

    const asset = await readVerifiedRendererAsset(
      "app://desktop/index.html",
      developmentRoot,
    );
    expect(Buffer.from(asset.body).toString("utf8")).toBe("development");
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
