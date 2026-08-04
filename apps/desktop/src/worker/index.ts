import { attachTransferredUtilityWorker, type UtilityParentPort } from "./entrypoint";

const parentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort;

if (!parentPort) {
  throw new Error("Utility worker requires process.parentPort");
}

attachTransferredUtilityWorker(parentPort);
