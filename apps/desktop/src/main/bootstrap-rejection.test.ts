import { describe, expect, it, vi } from "vitest";

describe("production bootstrap failure", () => {
  it("emits only the stable code and exits once", async () => {
    vi.resetModules();
    const failure = new Error("account=secret-path");
    const startDesktop = vi.fn().mockRejectedValue(failure);
    const app = { exit: vi.fn(), on: vi.fn(), off: vi.fn(), quit: vi.fn() };
    const registerApplicationProtocolScheme = vi.fn();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.doMock("./index", () => ({ startDesktop }));
    vi.doMock("./app-protocol", () => ({ registerApplicationProtocolScheme }));
    vi.doMock("electron", () => ({ app }));

    // @ts-expect-error Vitest executes this isolated ESM module despite the workspace's script module target.
    await import("./bootstrap");
    await Promise.resolve();

    expect(app.exit).toHaveBeenCalledOnce();
    expect(app.exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(
      "Desktop startup failed: STARTUP_FAILED",
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret-path");
    error.mockRestore();
  });
});
