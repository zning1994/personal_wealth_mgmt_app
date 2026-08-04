import { beforeEach, describe, expect, it, vi } from "vitest";

const { messageChannelMain } = vi.hoisted(() => ({ messageChannelMain: vi.fn() }));
vi.mock("electron", () => ({ MessageChannelMain: messageChannelMain }));

import { createUtilityPort } from "./utility-port";

function createPort() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    postMessage: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }),
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    }),
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
  };
}

function createChild() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    postMessage: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }),
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    }),
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
  };
}

describe("createUtilityPort", () => {
  beforeEach(() => {
    messageChannelMain.mockReset();
  });

  it("transfers a MessagePort to the utility child and forwards only validated responses", () => {
    const mainPort = createPort();
    const workerPort = createPort();
    const child = createChild();
    messageChannelMain.mockReturnValue({ port1: mainPort, port2: workerPort });
    const utility = createUtilityPort(child as never);
    const listener = vi.fn();
    utility.onMessage(listener);

    expect(child.postMessage).toHaveBeenCalledWith({ type: "pwm:utility-port" }, [workerPort]);
    expect(mainPort.start).toHaveBeenCalledOnce();
    mainPort.emit("message", { data: { type: "progress", progress: { taskId: "018f4f7e-8ead-7c0d-8000-000000000201", phase: "running", completed: 0, total: 1 } } });
    mainPort.emit("message", { data: { type: "result", taskId: "invalid", result: { echo: "no" } } });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      type: "progress",
      progress: { taskId: "018f4f7e-8ead-7c0d-8000-000000000201", phase: "running", completed: 0, total: 1 },
    });
  });

  it("removes message and child listeners when the last subscriber unsubscribes", () => {
    const mainPort = createPort();
    const workerPort = createPort();
    const child = createChild();
    messageChannelMain.mockReturnValue({ port1: mainPort, port2: workerPort });
    const utility = createUtilityPort(child as never);

    const unsubscribe = utility.onMessage(vi.fn());
    unsubscribe();

    expect(mainPort.off).not.toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("rejects readiness, fails sends and removes exact listeners when the child exits", async () => {
    const mainPort = createPort();
    const workerPort = createPort();
    const child = createChild();
    messageChannelMain.mockReturnValue({ port1: mainPort, port2: workerPort });
    const utility = createUtilityPort(child as never);
    const disconnected = vi.fn();
    utility.onDisconnect?.(disconnected);
    const ready = utility.ready();
    const messageListener = mainPort.on.mock.calls.find(([event]) => event === "message")?.[1];
    const closeListener = mainPort.on.mock.calls.find(([event]) => event === "close")?.[1];
    const exitListener = child.on.mock.calls.find(([event]) => event === "exit")?.[1];
    const errorListener = child.on.mock.calls.find(([event]) => event === "error")?.[1];

    child.emit("exit", 1);

    await expect(ready).rejects.toThrow("Utility process transport is unavailable");
    expect(disconnected).toHaveBeenCalledOnce();
    expect(() => utility.postMessage({ type: "cancel", taskId: "018f4f7e-8ead-7c0d-8000-000000000202" as never })).toThrow(
      "Utility process transport is unavailable",
    );
    expect(mainPort.close).toHaveBeenCalledOnce();
    expect(mainPort.off).toHaveBeenCalledWith("message", messageListener);
    expect(mainPort.off).toHaveBeenCalledWith("close", closeListener);
    expect(child.off).toHaveBeenCalledWith("exit", exitListener);
    expect(child.off).toHaveBeenCalledWith("error", errorListener);
    expect(mainPort.listenerCount("message")).toBe(0);
    expect(mainPort.listenerCount("close")).toBe(0);
    expect(child.listenerCount("exit")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
  });

  it("fails sends and notifies subscribers when the MessagePort closes", () => {
    const mainPort = createPort();
    const workerPort = createPort();
    const child = createChild();
    messageChannelMain.mockReturnValue({ port1: mainPort, port2: workerPort });
    const utility = createUtilityPort(child as never);
    const disconnected = vi.fn();
    utility.onDisconnect?.(disconnected);

    mainPort.emit("close");

    expect(disconnected).toHaveBeenCalledOnce();
    expect(() => utility.postMessage({ type: "cancel", taskId: "018f4f7e-8ead-7c0d-8000-000000000203" as never })).toThrow();
    expect(mainPort.off).toHaveBeenCalledWith("close", expect.any(Function));
  });

  it("does not resolve readiness for an invalid ready message", async () => {
    const mainPort = createPort(); const workerPort = createPort(); const child = createChild();
    messageChannelMain.mockReturnValue({ port1: mainPort, port2: workerPort });
    const utility = createUtilityPort(child as never);
    let resolved = false;
    void utility.ready().then(() => { resolved = true; });
    mainPort.emit("message", { data: { type: "pwm:utility-ready", extra: true } });
    await Promise.resolve();
    expect(resolved).toBe(false);
    mainPort.emit("message", { data: { type: "pwm:utility-ready" } });
    await utility.ready();
    expect(resolved).toBe(true);
  });

  it("cleans exact listeners and both ports when port start throws", async () => {
    const mainPort = createPort(); const workerPort = createPort(); const child = createChild();
    mainPort.start.mockImplementation(() => { throw new Error("start failed"); });
    messageChannelMain.mockReturnValue({ port1: mainPort, port2: workerPort });
    expect(() => createUtilityPort(child as never)).toThrow("start failed");
    const messageListener = mainPort.on.mock.calls.find(([event]) => event === "message")?.[1];
    const closeListener = mainPort.on.mock.calls.find(([event]) => event === "close")?.[1];
    const exitListener = child.on.mock.calls.find(([event]) => event === "exit")?.[1];
    const errorListener = child.on.mock.calls.find(([event]) => event === "error")?.[1];
    expect(mainPort.off).toHaveBeenCalledWith("message", messageListener);
    expect(mainPort.off).toHaveBeenCalledWith("close", closeListener);
    expect(child.off).toHaveBeenCalledWith("exit", exitListener);
    expect(child.off).toHaveBeenCalledWith("error", errorListener);
    expect(mainPort.listenerCount("message")).toBe(0);
    expect(mainPort.listenerCount("close")).toBe(0);
    expect(child.listenerCount("exit")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
    expect(mainPort.close).toHaveBeenCalledOnce();
    expect(workerPort.close).toHaveBeenCalledOnce();
  });
});
