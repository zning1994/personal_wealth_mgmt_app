import { beforeEach, describe, expect, it, vi } from "vitest";

const { browserWindow } = vi.hoisted(() => ({ browserWindow: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: browserWindow }));

import { createMainWindow } from "./window";

describe("createMainWindow", () => {
  beforeEach(() => {
    browserWindow.mockReset();
  });

  it("creates a locked window and loads the renderer URL", () => {
    const show = vi.fn();
    const loadURL = vi.fn();
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

    const result = createMainWindow({
      preloadPath: "/app/preload.cjs",
      rendererUrl: "app://desktop/index.html",
    });

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

  it.each(["https://desktop/index.html", "not a URL"])(
    "rejects an invalid renderer URL before creating a window: %s",
    (rendererUrl) => {
      expect(() =>
        createMainWindow({ preloadPath: "/app/preload.cjs", rendererUrl }),
      ).toThrow("Renderer URL must use the app protocol");
      expect(browserWindow).not.toHaveBeenCalled();
    },
  );
});
