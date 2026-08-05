import { describe, expect, it, vi } from "vitest";
import { installBootstrapLifecycle } from "./bootstrap-lifecycle";

function appDouble() {
  const listeners = new Map<string, () => void>();
  return {
    app: {
      on: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
      off: vi.fn((event: string, listener: () => void) => {
        if (listeners.get(event) === listener) listeners.delete(event);
      }),
      quit: vi.fn(),
    },
    listeners,
  };
}

describe("installBootstrapLifecycle", () => {
  it("keeps the macOS app resident and starts one fresh composition on activate", () => {
    const { app, listeners } = appDouble();
    const launch = vi.fn();
    const uninstall = installBootstrapLifecycle(app, "darwin", launch);

    expect(app.on).toHaveBeenCalledTimes(2);
    listeners.get("window-all-closed")?.();
    expect(app.quit).not.toHaveBeenCalled();
    listeners.get("activate")?.();
    expect(launch).toHaveBeenCalledOnce();

    uninstall();
  });

  it("quits Windows after the final window closes", () => {
    const { app, listeners } = appDouble();
    installBootstrapLifecycle(app, "win32", vi.fn());

    listeners.get("window-all-closed")?.();
    expect(app.quit).toHaveBeenCalledOnce();
  });
});
