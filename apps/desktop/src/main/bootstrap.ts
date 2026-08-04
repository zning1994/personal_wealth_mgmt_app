import { app } from "electron";
import { registerApplicationProtocolScheme } from "./app-protocol";
import { installBootstrapLifecycle } from "./bootstrap-lifecycle";
import { startDesktop } from "./index";

registerApplicationProtocolScheme();

let pendingLaunch: Promise<void> | undefined;
let fatalHandled = false;

function handleFatalLaunch(error?: unknown): void {
  if (fatalHandled) return;
  fatalHandled = true;
  if (process.env.PWM_DEBUG_STARTUP === "1") console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  console.error("Desktop startup failed: STARTUP_FAILED");
  app.exit(1);
}

function launchDesktop(): void {
  if (fatalHandled || pendingLaunch) return;
  let launch: Promise<void>;
  try {
    launch = startDesktop();
  } catch (error: unknown) {
    handleFatalLaunch(error);
    return;
  }
  pendingLaunch = launch;
  void launch.then(
    () => {
      if (pendingLaunch === launch) pendingLaunch = undefined;
    },
    (error: unknown) => {
      if (pendingLaunch === launch) pendingLaunch = undefined;
      handleFatalLaunch(error);
    },
  );
}

installBootstrapLifecycle(app, process.platform, launchDesktop);
launchDesktop();
