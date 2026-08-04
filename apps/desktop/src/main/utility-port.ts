import { MessageChannelMain, type MessageEvent as ElectronMessageEvent, type UtilityProcess } from "electron";
import { WorkerRequestSchema, WorkerResponseSchema, type WorkerRequest } from "@pwm/contracts";
import type { UtilityPort } from "./task-coordinator";

export type ManagedUtilityPort = UtilityPort & {
  dispose(): void;
};

const UTILITY_PORT_TRANSFER = "pwm:utility-port";
const TRANSPORT_UNAVAILABLE = "Utility process transport is unavailable";

export function createUtilityPort(child: UtilityProcess): ManagedUtilityPort {
  const channel = new MessageChannelMain();
  const port = channel.port1;
  const listeners = new Set<(message: unknown) => void>();
  const disconnectListeners = new Set<() => void>();
  let available = true;
  let disposed = false;
  let messageListenerAttached = false;

  const onMessage = (event: ElectronMessageEvent) => {
    const response = WorkerResponseSchema.safeParse(event.data);
    if (!response.success) return;
    for (const listener of listeners) listener(response.data);
  };

  const detachMessageListener = () => {
    if (!messageListenerAttached) return;
    port.off("message", onMessage);
    messageListenerAttached = false;
  };

  const detachChildListeners = () => {
    child.off("exit", onChildUnavailable);
    child.off("error", onChildUnavailable);
  };

  const closePort = () => {
    try {
      port.close();
    } catch {
      // A closed MessagePort has already released its native resource.
    }
  };

  const markUnavailable = () => {
    if (!available) return;
    available = false;
    detachMessageListener();
    detachChildListeners();
    closePort();
    for (const listener of disconnectListeners) listener();
  };

  function onChildUnavailable(): void {
    markUnavailable();
  }

  try {
    child.postMessage({ type: UTILITY_PORT_TRANSFER }, [channel.port2]);
    child.on("exit", onChildUnavailable);
    child.on("error", onChildUnavailable);
    port.start();
  } catch (error) {
    available = false;
    detachChildListeners();
    closePort();
    throw error;
  }

  return {
    postMessage(message: WorkerRequest): void {
      if (!available || disposed) throw new Error(TRANSPORT_UNAVAILABLE);
      port.postMessage(WorkerRequestSchema.parse(message));
    },
    onMessage(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      if (!messageListenerAttached && available) {
        port.on("message", onMessage);
        messageListenerAttached = true;
      }
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
        if (listeners.size === 0) detachMessageListener();
      };
    },
    onDisconnect(listener) {
      if (disposed) return () => undefined;
      disconnectListeners.add(listener);
      if (!available) listener();
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        disconnectListeners.delete(listener);
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      disconnectListeners.clear();
      detachMessageListener();
      detachChildListeners();
      available = false;
      closePort();
    },
  };
}
