import { describe, expect, it, vi } from "vitest";
import { commandSchemas } from "@pwm/contracts";
import { registerCommandHandlers } from "./ipc";

describe("registerCommandHandlers", () => {
  it("rejects invalid input before calling a handler", async () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi.fn((name: string, fn: (...args: unknown[]) => unknown) => registered.set(name, fn));
    const start = vi.fn();
    registerCommandHandlers({ handle, removeHandler: vi.fn() } as never, {
      "app:get-info": () => ({ name: "Personal Wealth", version: "0.1.0", platform: "darwin" }),
      "task:start": start,
      "task:cancel": () => ({ cancelled: false }),
    });

    await expect(registered.get("task:start")?.({}, { kind: "shell", payload: {} })).rejects.toThrow();
    expect(start).not.toHaveBeenCalled();
  });

  it("registers only allowlisted channels and removes those exact handlers", () => {
    const handle = vi.fn();
    const removeHandler = vi.fn();
    const dispose = registerCommandHandlers({ handle, removeHandler } as never, {
      "app:get-info": () => ({ name: "Personal Wealth", version: "0.1.0", platform: "darwin" }),
      "task:start": () => ({ taskId: "018f4f7e-8ead-7c0d-8000-000000000101" as never }),
      "task:cancel": () => ({ cancelled: false }),
    });

    expect(handle.mock.calls.map(([channel]) => channel).sort()).toEqual(Object.keys(commandSchemas).sort());
    dispose();
    expect(removeHandler.mock.calls.map(([channel]) => channel).sort()).toEqual(Object.keys(commandSchemas).sort());
  });

  it("rejects invalid handler output before returning it to the renderer", async () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi.fn((name: string, fn: (...args: unknown[]) => unknown) => registered.set(name, fn));
    registerCommandHandlers({ handle, removeHandler: vi.fn() } as never, {
      "app:get-info": (() => ({ name: "Personal Wealth" })) as never,
      "task:start": () => ({ taskId: "018f4f7e-8ead-7c0d-8000-000000000102" as never }),
      "task:cancel": () => ({ cancelled: false }),
    });

    await expect(registered.get("app:get-info")?.({}, {})).rejects.toThrow();
  });

  it("rolls back earlier registrations when a later handle fails", () => {
    const removeHandler = vi.fn();
    const handle = vi.fn().mockImplementation((channel: string) => {
      if (channel === "task:start") throw new Error("registration failed");
    });
    const handlers = {
      "app:get-info": () => ({ name: "Personal Wealth" as const, version: "0.1.0", platform: "darwin" as const }),
      "task:start": () => ({ taskId: "018f4f7e-8ead-7c0d-8000-000000000103" as never }),
      "task:cancel": () => ({ cancelled: false }),
    };

    expect(() => registerCommandHandlers({ handle, removeHandler } as never, handlers)).toThrow("registration failed");
    expect(removeHandler).toHaveBeenCalledWith("app:get-info");
  });
});
