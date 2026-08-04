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
const UTILITY_READY_TIMEOUT_MS = 5_000;

let startup: Promise<void> | undefined;

function desktopPlatform(): "darwin" | "win32" {
  if (process.platform === "darwin" || process.platform === "win32") return process.platform;
  throw new Error("Unsupported desktop platform");
}

function bundledPath(...segments: string[]): string {
  return join(app.getAppPath(), "dist", ...segments);
}

async function awaitUtilityReady(port: ManagedUtilityPort): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      port.ready(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Utility process readiness timed out")), UTILITY_READY_TIMEOUT_MS);
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
    disposeDesktop(coordinator, port, unregisterHandlers, child, mainWindow);
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
      "app:get-info": () => ({ name: "Personal Wealth", version: app.getVersion(), platform: desktopPlatform() }),
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
