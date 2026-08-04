import { UtilityReadySchema } from "@pwm/contracts";
import { attachUtilityWorkerPort, type UtilityWorkerPort } from "./task-runtime";

export const INVALID_WORKER_MESSAGE_DIAGNOSTIC = "invalid-worker-message";
export const UTILITY_READY_MESSAGE = UtilityReadySchema.parse({ type: "pwm:utility-ready" });

export interface UtilityParentPort {
  once(event: "message", listener: (event: { ports: unknown[] }) => void): void;
}

type TransferredMessagePort = {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  off(event: "message", listener: (event: { data: unknown }) => void): void;
  start(): void;
};

function isTransferredMessagePort(value: unknown): value is TransferredMessagePort {
  if (typeof value !== "object" || value === null) return false;
  const port = value as Partial<TransferredMessagePort>;
  return (
    typeof port.postMessage === "function" &&
    typeof port.on === "function" &&
    typeof port.off === "function" &&
    typeof port.start === "function"
  );
}

export function attachProductionUtilityWorker(
  port: UtilityWorkerPort,
  reportDiagnostic: (diagnostic: string) => void = (diagnostic) => process.emitWarning(diagnostic),
): () => void {
  return attachUtilityWorkerPort(port, {
    onInvalidMessage: () => reportDiagnostic(INVALID_WORKER_MESSAGE_DIAGNOSTIC),
  });
}

export function attachTransferredUtilityWorker(parentPort: UtilityParentPort): void {
  parentPort.once("message", (event) => {
    const port = event.ports[0];
    if (!isTransferredMessagePort(port)) throw new Error("Utility worker requires a transferred MessagePort");
    attachProductionUtilityWorker({
      postMessage: (message) => port.postMessage(message),
      onMessage: (listener) => {
        const onMessage = (messageEvent: { data: unknown }) => listener(messageEvent.data);
        port.on("message", onMessage);
        return () => port.off("message", onMessage);
      },
    });
    port.start();
    port.postMessage(UTILITY_READY_MESSAGE);
  });
}
