import { describe, expect, it, vi } from "vitest";
import {
  installWindowSecurity,
  isAllowedApplicationUrl,
  lockWebContents,
  secureWebPreferences,
} from "./window-security";

describe("window security", () => {
  it("locks renderer privileges", () => {
    expect(secureWebPreferences("/app/preload.cjs")).toMatchObject({
      preload: "/app/preload.cjs",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    });
  });

  it("allows only the exact application origin", () => {
    expect(isAllowedApplicationUrl("app://desktop/index.html", "app://desktop")).toBe(true);
    expect(isAllowedApplicationUrl("app://desktop.evil/index.html", "app://desktop")).toBe(false);
    expect(isAllowedApplicationUrl("https://desktop/index.html", "https://desktop")).toBe(false);
    expect(isAllowedApplicationUrl("https://example.com", "app://desktop")).toBe(false);
    expect(isAllowedApplicationUrl("file:///tmp/statement.pdf", "app://desktop")).toBe(false);
    expect(isAllowedApplicationUrl("not a URL", "app://desktop")).toBe(false);
    expect(isAllowedApplicationUrl("app://desktop/index.html", "not a URL")).toBe(false);
  });

  it("denies permissions and external network requests", () => {
    const permissionRequestHandler = vi.fn();
    const permissionCheckHandler = vi.fn();
    const onBeforeRequest = vi.fn();
    const targetSession = {
      setPermissionRequestHandler: permissionRequestHandler,
      setPermissionCheckHandler: permissionCheckHandler,
      webRequest: { onBeforeRequest },
    };

    installWindowSecurity(targetSession as never, "app://desktop");

    const requestHandler = permissionRequestHandler.mock.calls[0]?.[0];
    const checkHandler = permissionCheckHandler.mock.calls[0]?.[0];
    const networkHandler = onBeforeRequest.mock.calls[0]?.[1];
    const permissionCallback = vi.fn();
    const networkCallback = vi.fn();

    requestHandler?.({} as never, "notifications", permissionCallback, {} as never);
    expect(permissionCallback).toHaveBeenCalledWith(false);
    expect(checkHandler?.({} as never, "notifications", "https://example.com", {} as never)).toBe(false);
    expect(onBeforeRequest).toHaveBeenCalledWith(
      { urls: ["http://*/*", "https://*/*", "file://*/*"] },
      expect.any(Function),
    );
    networkHandler?.({} as never, networkCallback);
    expect(networkCallback).toHaveBeenCalledWith({ cancel: true });
  });

  it("installs each session policy only once", () => {
    const setPermissionRequestHandler = vi.fn();
    const setPermissionCheckHandler = vi.fn();
    const onBeforeRequest = vi.fn();
    const targetSession = {
      setPermissionRequestHandler,
      setPermissionCheckHandler,
      webRequest: { onBeforeRequest },
    };

    installWindowSecurity(targetSession as never, "app://desktop");
    installWindowSecurity(targetSession as never, "app://desktop");

    expect(setPermissionRequestHandler).toHaveBeenCalledOnce();
    expect(setPermissionCheckHandler).toHaveBeenCalledOnce();
    expect(onBeforeRequest).toHaveBeenCalledOnce();
  });

  it("blocks navigation outside the application origin and all new windows", () => {
    const willNavigate = vi.fn();
    const setWindowOpenHandler = vi.fn();
    const contents = { on: willNavigate, setWindowOpenHandler };

    lockWebContents(contents as never, "app://desktop");

    const navigationHandler = willNavigate.mock.calls[0]?.[1];
    const preventDefault = vi.fn();
    navigationHandler?.({ preventDefault } as never, "https://example.com");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(setWindowOpenHandler.mock.calls[0]?.[0]({})).toEqual({ action: "deny" });
  });
});
