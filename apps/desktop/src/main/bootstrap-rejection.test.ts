import { describe, expect, it, vi } from "vitest";

describe("production bootstrap failure", () => {
  it("reuses one pending launch and emits only one stable fatal exit", async () => {
    vi.resetModules();
    const failure = new Error("account=secret-path");
    let rejectStartup: ((error: Error) => void) | undefined;
    const pending = new Promise<void>((_resolve, reject) => { rejectStartup = reject; });
    const startDesktop = vi.fn(() => pending);
    const app = { exit: vi.fn(), on: vi.fn(), off: vi.fn(), quit: vi.fn() };
    const registerApplicationProtocolScheme = vi.fn();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.doMock("./index", () => ({ startDesktop }));
    vi.doMock("./app-protocol", () => ({ registerApplicationProtocolScheme }));
    vi.doMock("electron", () => ({ app }));

    await import("./bootstrap");
    const activate = app.on.mock.calls.find(([event]) => event === "activate")?.[1] as (() => void) | undefined;
    activate?.();
    activate?.();
    expect(startDesktop).toHaveBeenCalledOnce();

    rejectStartup?.(failure);
    await Promise.resolve();
    await Promise.resolve();

    expect(app.exit).toHaveBeenCalledOnce();
    expect(app.exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(
      "Desktop startup failed: STARTUP_FAILED",
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret-path");
    activate?.();
    expect(startDesktop).toHaveBeenCalledOnce();
    expect(app.exit).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
