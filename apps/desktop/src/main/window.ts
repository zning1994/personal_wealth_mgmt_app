import { BrowserWindow } from "electron";
import { installWindowSecurity, lockWebContents, secureWebPreferences } from "./window-security";

function applicationOriginFromRendererUrl(rendererUrl: string): string {
  let parsedRendererUrl: URL;
  try {
    parsedRendererUrl = new URL(rendererUrl);
  } catch {
    throw new Error("Renderer URL must use the app protocol");
  }
  if (parsedRendererUrl.protocol !== "app:" || parsedRendererUrl.host === "") {
    throw new Error("Renderer URL must use the app protocol");
  }
  return `${parsedRendererUrl.protocol}//${parsedRendererUrl.host}`;
}

export function createMainWindow(options: { preloadPath: string; rendererUrl: string }): BrowserWindow {
  const applicationOrigin = applicationOriginFromRendererUrl(options.rendererUrl);
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    show: false,
    webPreferences: secureWebPreferences(options.preloadPath),
  });
  installWindowSecurity(window.webContents.session, applicationOrigin);
  lockWebContents(window.webContents, applicationOrigin);
  window.once("ready-to-show", () => window.show());
  void window.loadURL(options.rendererUrl);
  return window;
}
