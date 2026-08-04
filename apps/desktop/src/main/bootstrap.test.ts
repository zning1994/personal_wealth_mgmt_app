import { describe, expect, it, vi } from "vitest";

const { startDesktop, registerApplicationProtocolScheme, app, startup } =
  vi.hoisted(() => {
    const startup: { resolve?: () => void } = {};
    const pending = new Promise<void>((resolve) => {
      startup.resolve = resolve;
    });
    return {
      startDesktop: vi.fn(() => pending),
      registerApplicationProtocolScheme: vi.fn(),
      app: { exit: vi.fn(), on: vi.fn(), off: vi.fn(), quit: vi.fn() },
      startup,
    };
  });
vi.mock("./index", () => ({ startDesktop }));
vi.mock("./app-protocol", () => ({ registerApplicationProtocolScheme }));
vi.mock("electron", () => ({ app }));

import "./bootstrap";

describe("production bootstrap", () => {
  it("deduplicates a pending activate and permits a later successful activate", async () => {
    expect(registerApplicationProtocolScheme).toHaveBeenCalledOnce();
    expect(startDesktop).toHaveBeenCalledOnce();
    expect(app.on).toHaveBeenCalledWith("activate", expect.any(Function));
    expect(app.on).toHaveBeenCalledWith("window-all-closed", expect.any(Function));
    const activate = app.on.mock.calls.find(([event]) => event === "activate")?.[1] as (() => void) | undefined;
    activate?.();
    expect(startDesktop).toHaveBeenCalledOnce();
    expect(
      registerApplicationProtocolScheme.mock.invocationCallOrder[0],
    ).toBeLessThan(
      startDesktop.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    startup.resolve?.();
    await Promise.resolve();
    activate?.();
    expect(startDesktop).toHaveBeenCalledTimes(2);
  });
});
