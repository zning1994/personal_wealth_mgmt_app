interface BootstrapApp {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
  quit(): unknown;
}

export function installBootstrapLifecycle(
  targetApp: BootstrapApp,
  platform: NodeJS.Platform,
  launch: () => void,
): () => void {
  const onActivate = () => launch();
  const onWindowAllClosed = () => {
    if (platform !== "darwin") targetApp.quit();
  };

  targetApp.on("activate", onActivate);
  targetApp.on("window-all-closed", onWindowAllClosed);

  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    targetApp.off("activate", onActivate);
    targetApp.off("window-all-closed", onWindowAllClosed);
  };
}
