import { app } from "electron";
import { registerApplicationProtocolScheme } from "./app-protocol";
import { installBootstrapLifecycle } from "./bootstrap-lifecycle";
import { startDesktop } from "./index";

registerApplicationProtocolScheme();

let pendingLaunch: Promise<void> | undefined;
let fatalHandled = false;

function handleFatalLaunch(): void {
  if (fatalHandled) return;
  fatalHandled = true;
  console.error("Desktop startup failed: STARTUP_FAILED");
  app.exit(1);
}

function launchDesktop(): void {
  if (fatalHandled || pendingLaunch) return;
  let launch: Promise<void>;
  try {
    launch = startDesktop();
  } catch {
    handleFatalLaunch();
    return;
  }
  pendingLaunch = launch;
  void launch.then(
    () => {
      if (pendingLaunch === launch) pendingLaunch = undefined;
    },
    () => {
      if (pendingLaunch === launch) pendingLaunch = undefined;
      handleFatalLaunch();
    },
  );
}

installBootstrapLifecycle(app, process.platform, launchDesktop);
launchDesktop();
