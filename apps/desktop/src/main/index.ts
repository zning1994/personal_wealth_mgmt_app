import { app, ipcMain, session, utilityProcess } from "electron";
import { join } from "node:path";
import type { BrowserWindow, UtilityProcess } from "electron";
import type { CommandHandlers } from "./ipc";
import { registerCommandHandlers } from "./ipc";
import { TaskCoordinator } from "./task-coordinator";
import { createUtilityPort, type ManagedUtilityPort } from "./utility-port";
import { installWindowSecurity } from "./window-security";
import { createMainWindow } from "./window";

const RENDERER_URL = "app://personal-wealth/index.html";
const APPLICATION_ORIGIN = "app://personal-wealth";

let startup: Promise<void> | undefined;

function desktopPlatform(): "darwin" | "win32" {
  return process.platform === "win32" ? "win32" : "darwin";
}

function bundledPath(...segments: string[]): string {
  return join(app.getAppPath(), "dist", ...segments);
}

function disposeDesktop(
  coordinator: TaskCoordinator | undefined,
  port: ManagedUtilityPort | undefined,
  unregisterHandlers: (() => void) | undefined,
  child: UtilityProcess | undefined,
): void {
  unregisterHandlers?.();
  coordinator?.dispose();
  port?.dispose();
  try {
    child?.kill();
  } catch {
    // UtilityProcess cleanup must not prevent the remaining shutdown operations.
  }
}

async function start(): Promise<void> {
  await app.whenReady();
  installWindowSecurity(session.defaultSession, APPLICATION_ORIGIN);

  let child: UtilityProcess | undefined;
  let port: ManagedUtilityPort | undefined;
  let coordinator: TaskCoordinator | undefined;
  let unregisterHandlers: (() => void) | undefined;
  let mainWindow: BrowserWindow | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disposeDesktop(coordinator, port, unregisterHandlers, child);
  };

  try {
    child = utilityProcess.fork(bundledPath("worker", "index.js"));
    port = createUtilityPort(child);
    coordinator = new TaskCoordinator(port, (progress) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send("task:progress", progress);
    });
    const handlers: CommandHandlers = {
      "app:get-info": () => ({ name: "Personal Wealth", version: "0.1.0", platform: desktopPlatform() }),
      "task:start": (input) => coordinator?.start(input) ?? Promise.reject(new Error("Task coordinator unavailable")),
      "task:cancel": (input) => coordinator?.cancel(input) ?? { cancelled: false },
    };
    unregisterHandlers = registerCommandHandlers(ipcMain, handlers);
    mainWindow = createMainWindow({
      preloadPath: bundledPath("preload", "index.js"),
      rendererUrl: RENDERER_URL,
    });
    app.once("before-quit", dispose);
  } catch (error) {
    dispose();
    throw error;
  }
}

export async function startDesktop(): Promise<void> {
  if (startup) return startup;
  const currentStartup = start();
  startup = currentStartup;
  try {
    await currentStartup;
  } catch (error) {
    if (startup === currentStartup) startup = undefined;
    throw error;
  }
}
