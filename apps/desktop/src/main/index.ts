import { app, ipcMain, session, utilityProcess } from "electron";
import { basename, dirname, join } from "node:path";
import type { BrowserWindow, UtilityProcess } from "electron";
import type { CommandHandlers } from "./ipc";
import {
  APPLICATION_ENTRY_URL,
  APPLICATION_ORIGIN,
  installApplicationProtocol,
} from "./app-protocol";
import { registerCommandHandlers } from "./ipc";
import { TaskCoordinator } from "./task-coordinator";
import { createUtilityPort, type ManagedUtilityPort } from "./utility-port";
import { installWindowSecurity } from "./window-security";
import { createMainWindow } from "./window";

const UTILITY_READY_TIMEOUT_MS = 5_000;

interface StartupGeneration {
  readonly token: object;
  readonly promise: Promise<void>;
}

let startup: StartupGeneration | undefined;

function desktopPlatform(): "darwin" | "win32" {
  if (process.platform === "darwin" || process.platform === "win32")
    return process.platform;
  throw new Error("Unsupported desktop platform");
}

function bundledPath(...segments: string[]): string {
  const appPath = app.getAppPath();
  const parent = dirname(appPath);
  const outputRoot =
    basename(appPath) === "main" && basename(parent) === "out"
      ? parent
      : join(appPath, "out");
  return join(outputRoot, ...segments);
}

async function awaitUtilityReady(port: ManagedUtilityPort): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      port.ready(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Utility process readiness timed out")),
          UTILITY_READY_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function disposeDesktop(
  coordinator: TaskCoordinator | undefined,
  port: ManagedUtilityPort | undefined,
  unregisterHandlers: (() => void) | undefined,
  child: UtilityProcess | undefined,
  mainWindow: BrowserWindow | undefined,
): void {
  unregisterHandlers?.();
  coordinator?.dispose();
  port?.dispose();
  try {
    child?.kill();
  } catch {
    // UtilityProcess cleanup must not prevent the remaining shutdown operations.
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
}

async function start(token: object): Promise<void> {
  await app.whenReady();
  app.setAppUserModelId("com.personalwealth.desktop");
  installApplicationProtocol(bundledPath("renderer"));
  installWindowSecurity(session.defaultSession, APPLICATION_ORIGIN);

  let child: UtilityProcess | undefined;
  let port: ManagedUtilityPort | undefined;
  let coordinator: TaskCoordinator | undefined;
  let unregisterHandlers: (() => void) | undefined;
  let mainWindow: BrowserWindow | undefined;
  let disposed = false;
  let beforeQuitAttached = false;
  let windowClosedAttached = false;
  const onBeforeQuit = () => dispose();
  const onWindowClosed = () => dispose();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (beforeQuitAttached) {
      app.off("before-quit", onBeforeQuit);
      beforeQuitAttached = false;
    }
    if (mainWindow && windowClosedAttached) {
      mainWindow.off("closed", onWindowClosed);
      windowClosedAttached = false;
    }
    disposeDesktop(coordinator, port, unregisterHandlers, child, mainWindow);
    if (startup?.token === token) startup = undefined;
  };

  try {
    child = utilityProcess.fork(bundledPath("worker", "index.js"));
    port = createUtilityPort(child);
    await awaitUtilityReady(port);
    coordinator = new TaskCoordinator(port, (progress) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send("task:progress", progress);
    });
    const handlers: CommandHandlers = {
      "app:get-info": () => ({
        name: "Personal Wealth",
        version: app.getVersion(),
        platform: desktopPlatform(),
      }),
      "task:start": (input) =>
        coordinator?.start(input) ??
        Promise.reject(new Error("Task coordinator unavailable")),
      "task:cancel": (input) =>
        coordinator?.cancel(input) ?? { cancelled: false },
    };
    unregisterHandlers = registerCommandHandlers(ipcMain, handlers);
    mainWindow = await createMainWindow({
      preloadPath: bundledPath("preload", "index.js"),
      rendererUrl: APPLICATION_ENTRY_URL,
    });
    mainWindow.once("closed", onWindowClosed);
    windowClosedAttached = true;
    app.once("before-quit", onBeforeQuit);
    beforeQuitAttached = true;
  } catch (error) {
    dispose();
    throw error;
  }
}

export async function startDesktop(): Promise<void> {
  if (startup) return startup.promise;
  const token = {};
  const currentStartup = start(token);
  startup = { token, promise: currentStartup };
  try {
    await currentStartup;
  } catch (error) {
    if (startup?.token === token) startup = undefined;
    throw error;
  }
}
