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
    const once = vi.fn((event: string, callback: () => void) => {
      if (event === "ready-to-show") callback();
    });
    const webContents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
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
    expect(once).toHaveBeenCalledWith("ready-to-show", expect.any(Function));
    expect(show).toHaveBeenCalledOnce();
    expect(loadURL).toHaveBeenCalledWith("app://desktop/index.html");
  });
});
