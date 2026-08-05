import { beforeEach, describe, expect, it, vi } from "vitest";

const { browserWindow } = vi.hoisted(() => ({ browserWindow: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: browserWindow }));

import { createMainWindow } from "./window";

describe("createMainWindow", () => {
  beforeEach(() => {
    browserWindow.mockReset();
  });

  it("creates a locked window and awaits the renderer URL", async () => {
    const show = vi.fn();
    let resolveLoad: (() => void) | undefined;
    const loadURL = vi.fn(() => new Promise<void>((resolve) => {
      resolveLoad = resolve;
    }));
    let readyToShow: (() => void) | undefined;
    const once = vi.fn((event: string, callback: () => void) => {
      if (event === "ready-to-show") readyToShow = callback;
    });
    const setPermissionRequestHandler = vi.fn();
    const setPermissionCheckHandler = vi.fn();
    const onBeforeRequest = vi.fn();
    const session = {
      setPermissionRequestHandler,
      setPermissionCheckHandler,
      webRequest: { onBeforeRequest },
    };
    const webContents = { session, on: vi.fn(), setWindowOpenHandler: vi.fn() };
    const fakeWindow = { webContents, once, show, loadURL };
    browserWindow.mockReturnValue(fakeWindow);

    const loading = createMainWindow({
      preloadPath: "/app/preload.cjs",
      rendererUrl: "app://desktop/index.html",
    });

    let settled = false;
    void loading.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveLoad?.();
    const result = await loading;

    expect(result).toBe(fakeWindow);
    expect(browserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 1180,
        height: 760,
        minWidth: 900,
        minHeight: 640,
        show: false,
        webPreferences: expect.objectContaining({
          preload: "/app/preload.cjs",
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
        }),
      }),
    );
    expect(webContents.on).toHaveBeenCalledWith("will-navigate", expect.any(Function));
    expect(webContents.setWindowOpenHandler.mock.calls[0]?.[0]({})).toEqual({ action: "deny" });
    expect(setPermissionRequestHandler).toHaveBeenCalledOnce();
    expect(setPermissionCheckHandler).toHaveBeenCalledOnce();
    expect(onBeforeRequest).toHaveBeenCalledOnce();
    const permissionCallback = vi.fn();
    const networkCallback = vi.fn();
    setPermissionRequestHandler.mock.calls[0]?.[0]({} as never, "notifications", permissionCallback, {} as never);
    onBeforeRequest.mock.calls[0]?.[1]({} as never, networkCallback);
    expect(permissionCallback).toHaveBeenCalledWith(false);
    expect(networkCallback).toHaveBeenCalledWith({ cancel: true });
    expect(once).toHaveBeenCalledWith("ready-to-show", expect.any(Function));
    expect(loadURL).toHaveBeenCalledWith("app://desktop/index.html");
    expect(show).not.toHaveBeenCalled();
    readyToShow?.();
    expect(show).toHaveBeenCalledOnce();
  });

  it("destroys the partially created window and propagates initial load failure", async () => {
    let destroyed = false;
    const destroy = vi.fn(() => { destroyed = true; });
    const fakeWindow = {
      webContents: {
        session: {
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
          webRequest: { onBeforeRequest: vi.fn() },
        },
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
      once: vi.fn(),
      show: vi.fn(),
      loadURL: vi.fn().mockRejectedValue(new Error("renderer load failed")),
      destroy,
      isDestroyed: vi.fn(() => destroyed),
    };
    browserWindow.mockReturnValue(fakeWindow);

    await expect(createMainWindow({
      preloadPath: "/app/preload.cjs",
      rendererUrl: "app://desktop/index.html",
    })).rejects.toThrow("renderer load failed");
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("destroys its window exactly once when security setup throws after construction", async () => {
    let destroyed = false;
    const destroy = vi.fn(() => { destroyed = true; });
    const fakeWindow = {
      webContents: {
        session: {
          setPermissionRequestHandler: vi.fn(() => { throw new Error("security setup failed"); }),
          setPermissionCheckHandler: vi.fn(),
          webRequest: { onBeforeRequest: vi.fn() },
        },
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
      once: vi.fn(),
      show: vi.fn(),
      loadURL: vi.fn(),
      destroy,
      isDestroyed: vi.fn(() => destroyed),
    };
    browserWindow.mockReturnValue(fakeWindow);

    await expect(createMainWindow({
      preloadPath: "/app/preload.cjs",
      rendererUrl: "app://desktop/index.html",
    })).rejects.toThrow("security setup failed");
    expect(destroy).toHaveBeenCalledOnce();
    expect(fakeWindow.loadURL).not.toHaveBeenCalled();
  });

  it.each(["https://desktop/index.html", "not a URL"])(
    "rejects an invalid renderer URL before creating a window: %s",
    async (rendererUrl) => {
      await expect(
        createMainWindow({ preloadPath: "/app/preload.cjs", rendererUrl }),
      ).rejects.toThrow("Renderer URL must use the app protocol");
      expect(browserWindow).not.toHaveBeenCalled();
    },
  );
});
