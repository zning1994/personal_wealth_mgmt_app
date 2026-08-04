import type {
  OnBeforeRequestListenerDetails,
  Session,
  WebContents,
  WebPreferences,
} from "electron";

const securedSessions = new WeakSet<Session>();

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

export function isAllowedApplicationUrl(
  candidate: string,
  applicationOrigin: string,
): boolean {
  try {
    const candidateUrl = new URL(candidate);
    const allowedUrl = new URL(applicationOrigin);
    return (
      candidateUrl.protocol === "app:" &&
      allowedUrl.protocol === "app:" &&
      candidateUrl.host !== "" &&
      candidateUrl.host === allowedUrl.host
    );
  } catch {
    return false;
  }
}

export function installWindowSecurity(
  targetSession: Session,
  applicationOrigin: string,
  isInternalFileRequest: (url: string) => boolean = () => false,
): void {
  if (!isAllowedApplicationUrl(applicationOrigin, applicationOrigin)) {
    throw new Error("Application origin must use the app protocol");
  }
  if (securedSessions.has(targetSession)) return;
  targetSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "file://*/*"] },
    (details, callback) =>
      callback({
        cancel: !isProtocolInternalFileRequest(details, isInternalFileRequest),
      }),
  );
  securedSessions.add(targetSession);
}

export function isProtocolInternalFileRequest(
  details: Pick<
    OnBeforeRequestListenerDetails,
    "url" | "resourceType" | "webContentsId" | "webContents" | "frame"
  >,
  isInternalFileRequest: (url: string) => boolean,
): boolean {
  return (
    details.resourceType === "other" &&
    details.webContentsId === undefined &&
    details.webContents === undefined &&
    details.frame === undefined &&
    isInternalFileRequest(details.url)
  );
}

export function lockWebContents(
  contents: WebContents,
  applicationOrigin: string,
): void {
  contents.on("will-navigate", (event, url) => {
    if (!isAllowedApplicationUrl(url, applicationOrigin))
      event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
}
