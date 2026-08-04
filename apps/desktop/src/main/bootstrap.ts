import { app } from "electron";
import { registerApplicationProtocolScheme } from "./app-protocol";
import { startDesktop } from "./index";

registerApplicationProtocolScheme();

void startDesktop().catch(() => {
  console.error("Desktop startup failed: STARTUP_FAILED");
  app.exit(1);
});
