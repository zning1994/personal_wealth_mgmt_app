import { describe, expect, it, vi } from "vitest";

const { startDesktop, registerApplicationProtocolScheme, app } = vi.hoisted(
  () => ({
    startDesktop: vi.fn().mockResolvedValue(undefined),
    registerApplicationProtocolScheme: vi.fn(),
    app: { exit: vi.fn(), on: vi.fn(), off: vi.fn(), quit: vi.fn() },
  }),
);
vi.mock("./index", () => ({ startDesktop }));
vi.mock("./app-protocol", () => ({ registerApplicationProtocolScheme }));
vi.mock("electron", () => ({ app }));

import "./bootstrap";

describe("production bootstrap", () => {
  it("starts the desktop exactly once", () => {
    expect(registerApplicationProtocolScheme).toHaveBeenCalledOnce();
    expect(startDesktop).toHaveBeenCalledOnce();
    expect(app.on).toHaveBeenCalledWith("activate", expect.any(Function));
    expect(app.on).toHaveBeenCalledWith("window-all-closed", expect.any(Function));
    expect(
      registerApplicationProtocolScheme.mock.invocationCallOrder[0],
    ).toBeLessThan(
      startDesktop.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });
});
