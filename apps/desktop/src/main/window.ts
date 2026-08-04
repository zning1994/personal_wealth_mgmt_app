import { BrowserWindow } from "electron";
import { lockWebContents, secureWebPreferences } from "./window-security";

export function createMainWindow(options: { preloadPath: string; rendererUrl: string }): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    show: false,
    webPreferences: secureWebPreferences(options.preloadPath),
  });
  const rendererUrl = new URL(options.rendererUrl);
  lockWebContents(window.webContents, `${rendererUrl.protocol}//${rendererUrl.host}`);
  window.once("ready-to-show", () => window.show());
  void window.loadURL(options.rendererUrl);
  return window;
}
