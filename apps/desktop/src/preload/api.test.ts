import { describe, expect, it, vi } from "vitest";
import { createDesktopApi } from "./api";

describe("createDesktopApi", () => {
  it("exposes only the frozen allowlisted API and validates app info output", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ name: "Personal Wealth", version: "0.1.0", platform: "darwin" });
    const api = createDesktopApi({ invoke, on: vi.fn(), removeListener: vi.fn() } as never);

    await expect(api.getAppInfo()).resolves.toEqual({
      name: "Personal Wealth",
      version: "0.1.0",
      platform: "darwin",
    });
    expect(invoke).toHaveBeenCalledWith("app:get-info", {});
    expect(Object.keys(api)).toEqual(["getAppInfo", "startTask", "cancelTask", "onTaskProgress", "imports", "llm", "accounts", "ledger", "finance", "activity", "workspace"]);
    expect(Object.isFrozen(api)).toBe(true);
  });

  it("rejects invalid task input before IPC", async () => {
    const invoke = vi.fn();
    const api = createDesktopApi({ invoke, on: vi.fn(), removeListener: vi.fn() } as never);

    await expect(api.startTask({ kind: "health-check", payload: { echo: "x".repeat(129) } })).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects malformed IPC output", async () => {
    const invoke = vi.fn().mockResolvedValue({ taskId: "not-a-task-id" });
    const api = createDesktopApi({ invoke, on: vi.fn(), removeListener: vi.fn() } as never);

    await expect(api.startTask({ kind: "health-check", payload: { echo: "ok" } })).rejects.toThrow();
  });

  it("validates progress payloads and removes the exact wrapped listener once", () => {
    const on = vi.fn();
    const removeListener = vi.fn();
    const listener = vi.fn();
    const api = createDesktopApi({ invoke: vi.fn(), on, removeListener } as never);

    const unsubscribe = api.onTaskProgress(listener);
    const wrapped = on.mock.calls[0]?.[1] as (event: unknown, value: unknown) => void;
    const progress = {
      taskId: "018f3bf3-d4f8-7f08-95b8-63d7d72cfe2a",
      phase: "running",
      completed: 1,
      total: 2,
    };

    wrapped({}, progress);
    expect(listener).toHaveBeenCalledWith(progress);
    expect(() => wrapped({}, { ...progress, completed: 3 })).toThrow();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    unsubscribe();
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("task:progress", wrapped);
  });
});
