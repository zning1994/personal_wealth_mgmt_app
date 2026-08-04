import { createTaskRuntime } from "./task-runtime";

type UtilityParentPort = {
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: unknown) => void): void;
};

const parentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort;

if (!parentPort) {
  throw new Error("Utility worker requires process.parentPort");
}

const runtime = createTaskRuntime((message) => parentPort.postMessage(message));

parentPort.on("message", (message) => {
  void runtime.receive(message).catch(() => undefined);
});
