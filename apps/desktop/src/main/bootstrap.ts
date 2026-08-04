import { app } from "electron";
import { startDesktop } from "./index";

void startDesktop().catch((error: unknown) => {
  console.error("Desktop startup failed", error);
  app.exit(1);
});
