import { app } from "electron";
import { startDesktop } from "./index";

void startDesktop().catch(() => {
  console.error("Desktop startup failed: STARTUP_FAILED");
  app.exit(1);
});
