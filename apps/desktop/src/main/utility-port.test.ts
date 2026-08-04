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

  it("fails sends and notifies subscribers when the child exits", () => {
    const mainPort = createPort();
    const workerPort = createPort();
    const child = createChild();
    messageChannelMain.mockReturnValue({ port1: mainPort, port2: workerPort });
    const utility = createUtilityPort(child as never);
    const disconnected = vi.fn();
    utility.onDisconnect?.(disconnected);

    child.emit("exit", 1);

    expect(disconnected).toHaveBeenCalledOnce();
    expect(() => utility.postMessage({ type: "cancel", taskId: "018f4f7e-8ead-7c0d-8000-000000000202" as never })).toThrow(
      "Utility process transport is unavailable",
    );
    expect(mainPort.close).toHaveBeenCalledOnce();
    expect(child.off).toHaveBeenCalledWith("exit", expect.any(Function));
    expect(child.off).toHaveBeenCalledWith("error", expect.any(Function));
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
    expect(mainPort.off).toHaveBeenCalledWith("message", expect.any(Function));
    expect(mainPort.off).toHaveBeenCalledWith("close", expect.any(Function));
    expect(child.off).toHaveBeenCalledWith("exit", expect.any(Function));
    expect(child.off).toHaveBeenCalledWith("error", expect.any(Function));
    expect(mainPort.close).toHaveBeenCalledOnce();
    expect(workerPort.close).toHaveBeenCalledOnce();
  });
});
