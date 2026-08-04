import { app } from "electron";
import { registerApplicationProtocolScheme } from "./app-protocol";
import { installBootstrapLifecycle } from "./bootstrap-lifecycle";
import { startDesktop } from "./index";

registerApplicationProtocolScheme();

function launchDesktop(): void {
  void startDesktop().catch(() => {
    console.error("Desktop startup failed: STARTUP_FAILED");
    app.exit(1);
  });
}

installBootstrapLifecycle(app, process.platform, launchDesktop);
launchDesktop();
