import type { Session, WebContents, WebPreferences } from "electron";

export function secureWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
  };
}

export function isAllowedApplicationUrl(candidate: string, applicationOrigin: string): boolean {
  try {
    const candidateUrl = new URL(candidate);
    const allowedUrl = new URL(applicationOrigin);
    return candidateUrl.protocol === allowedUrl.protocol && candidateUrl.host === allowedUrl.host;
  } catch {
    return false;
  }
}

export function installWindowSecurity(targetSession: Session, applicationOrigin: string): void {
  void applicationOrigin;
  targetSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "file://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );
}

export function lockWebContents(contents: WebContents, applicationOrigin: string): void {
  contents.on("will-navigate", (event, url) => {
    if (!isAllowedApplicationUrl(url, applicationOrigin)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
}
