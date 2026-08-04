import { describe, expect, it } from "vitest";
import {
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
});
