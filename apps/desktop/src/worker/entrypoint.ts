import { attachUtilityWorkerPort, type UtilityWorkerPort } from "./task-runtime";

export const INVALID_WORKER_MESSAGE_DIAGNOSTIC = "invalid-worker-message";

export function attachProductionUtilityWorker(
  port: UtilityWorkerPort,
  reportDiagnostic: (diagnostic: string) => void = (diagnostic) => process.emitWarning(diagnostic),
): () => void {
  return attachUtilityWorkerPort(port, {
    onInvalidMessage: () => reportDiagnostic(INVALID_WORKER_MESSAGE_DIAGNOSTIC),
  });
}
