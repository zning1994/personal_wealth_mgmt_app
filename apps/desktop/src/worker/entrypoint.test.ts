import { describe, expect, it, vi } from "vitest";
import {
  attachTransferredUtilityWorker,
  INVALID_WORKER_MESSAGE_DIAGNOSTIC,
  attachProductionUtilityWorker,
} from "./entrypoint";
import type { UtilityWorkerPort } from "./task-runtime";

describe("production utility worker entrypoint", () => {
  it("reports malformed messages with a stable payload-free diagnostic", () => {
    const responses: unknown[] = [];
    const diagnostics: string[] = [];
    let listener: ((message: unknown) => void) | undefined;
    const port: UtilityWorkerPort = {
      postMessage(message) {
        responses.push(message);
      },
      onMessage(nextListener) {
        listener = nextListener;
        return () => undefined;
      },
    };

    attachProductionUtilityWorker(port, (diagnostic) => diagnostics.push(diagnostic));
    listener?.({ type: "start", taskId: "untrusted", payload: { secret: "do-not-log" } });

    expect(diagnostics).toEqual([INVALID_WORKER_MESSAGE_DIAGNOSTIC]);
    expect(responses).toEqual([]);
  });

  it("adapts the transferred MessagePort instead of the parent control port", async () => {
    let transferListener: ((event: { ports: unknown[] }) => void) | undefined;
    const parentPort = {
      once(_event: "message", listener: (event: { ports: unknown[] }) => void) {
        transferListener = listener;
      },
    };
    let messageListener: ((event: { data: unknown }) => void) | undefined;
    const port = {
      postMessage: (message: unknown) => responses.push(message),
      on(_event: "message", listener: (event: { data: unknown }) => void) {
        messageListener = listener;
      },
      off: () => undefined,
      start: () => undefined,
    };
    const responses: unknown[] = [];

    attachTransferredUtilityWorker(parentPort);
    transferListener?.({ ports: [port] });
    messageListener?.({
      data: {
        type: "start",
        taskId: "018f4f7e-8ead-7c0d-8000-000000000031",
        task: { kind: "health-check", payload: { echo: "ok" } },
      },
    });
    await vi.waitFor(() => {
      expect(responses).toContainEqual({
        type: "result",
        taskId: "018f4f7e-8ead-7c0d-8000-000000000031",
        result: { echo: "ok" },
      });
    }, { timeout: 1_000 });

    expect(responses).toContainEqual({
      type: "result",
      taskId: "018f4f7e-8ead-7c0d-8000-000000000031",
      result: { echo: "ok" },
    });
  });

  it("attaches the worker listener before starting the transferred port and then announces readiness", () => {
    let transferListener: ((event: { ports: unknown[] }) => void) | undefined;
    const events: string[] = [];
    const parentPort = { once: (_event: "message", listener: (event: { ports: unknown[] }) => void) => (transferListener = listener) };
    const port = {
      postMessage: (message: unknown) => events.push(JSON.stringify(message)),
      on: () => events.push("listener"),
      off: () => undefined,
      start: () => events.push("start"),
    };

    attachTransferredUtilityWorker(parentPort);
    transferListener?.({ ports: [port] });

    expect(events[0]).toBe("listener");
    expect(events[1]).toBe("start");
    expect(events[2]).toBe(JSON.stringify({ type: "pwm:utility-ready" }));
  });

  it("does not announce readiness when the transferred port cannot start", () => {
    let transferListener: ((event: { ports: unknown[] }) => void) | undefined;
    const responses: unknown[] = [];
    const parentPort = { once: (_event: "message", listener: (event: { ports: unknown[] }) => void) => (transferListener = listener) };
    const port = {
      postMessage: (message: unknown) => responses.push(message),
      on: () => undefined,
      off: () => undefined,
      start: () => {
        throw new Error("start failed");
      },
    };

    attachTransferredUtilityWorker(parentPort);

    expect(() => transferListener?.({ ports: [port] })).toThrow("start failed");
    expect(responses).toEqual([]);
  });
});
