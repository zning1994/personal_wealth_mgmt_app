import { attachUtilityWorkerPort } from "./task-runtime";

type UtilityParentPort = {
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: unknown) => void): void;
};

const parentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort;

if (!parentPort) {
  throw new Error("Utility worker requires process.parentPort");
}

attachUtilityWorkerPort({
  postMessage: (message) => parentPort.postMessage(message),
  onMessage: (listener) => {
    parentPort.on("message", listener);
    return () => undefined;
  },
});
