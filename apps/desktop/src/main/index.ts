import { app, ipcMain, session, utilityProcess } from "electron";
import { existsSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
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
import { createLocalImportController } from "./import/in-memory-import-controller";
import { registerImportIpc } from "./import/import-ipc";
import { createLocalLlmSettingsService } from "./settings/llm-settings-service";
import { registerLlmSettingsIpc } from "./settings/llm-settings-ipc";
import { registerLlmAnalysisIpc } from "./settings/llm-analysis-ipc";
import { registerAccountsIpc } from "./accounts-ipc";
import { LocalPdfOcrPipeline } from "./import/ocr-pipeline";
import { LocalPdfPageRenderer } from "./import/pdf-page-renderer";
import { registerLedgerIpc } from "./ledger/ledger-ipc";
import { registerFinanceIpc } from "./finance/finance-ipc";
import { registerActivityIpc } from "./activity/activity-ipc";

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

function bundledWorkerPath(...segments: string[]): string {
  const candidate = bundledPath(...segments);
  const marker = `${sep}app.asar${sep}`;
  if (!candidate.includes(marker)) return candidate;
  const unpacked = candidate.replace(marker, `${sep}app.asar.unpacked${sep}`);
  return existsSync(unpacked) ? unpacked : candidate;
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
  closeWorkspace: (() => Promise<void>) | undefined,
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
  void closeWorkspace?.();
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
  let closeWorkspace: (() => Promise<void>) | undefined;
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
    disposeDesktop(coordinator, port, unregisterHandlers, child, mainWindow, closeWorkspace);
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
    const unregisterShellHandlers = registerCommandHandlers(ipcMain, handlers);
    const ocrTempRoot = typeof app.getPath === "function" ? join(app.getPath("temp"), "personal-wealth-ocr") : undefined;
    const pdfOcr = ocrTempRoot === undefined ? undefined : new LocalPdfOcrPipeline({
      tempRoot: ocrTempRoot,
      workerScript: bundledWorkerPath("ocr", "index.js"),
      renderer: new LocalPdfPageRenderer({ rootDirectory: ocrTempRoot }),
    });
    const localImports = await (pdfOcr === undefined ? createLocalImportController() : createLocalImportController({ pdfOcr }));
    closeWorkspace = localImports.close;
    const unregisterImportHandlers = registerImportIpc(ipcMain, localImports.controller);
    const unregisterAccountHandlers = registerAccountsIpc(ipcMain, localImports.accounts, await localImports.controller.getWorkspaceId());
    const unregisterLedgerHandlers = registerLedgerIpc(ipcMain, localImports.ledger);
    const unregisterFinanceHandlers = registerFinanceIpc(ipcMain, localImports.finance);
    const unregisterActivityHandlers = registerActivityIpc(ipcMain, localImports.activity, await localImports.controller.getWorkspaceId());
    const llmSettings = createLocalLlmSettingsService();
    const unregisterLlmHandlers = llmSettings ? registerLlmSettingsIpc(ipcMain, llmSettings) : () => undefined;
    const unregisterLlmAnalysisHandlers = llmSettings ? registerLlmAnalysisIpc(ipcMain, llmSettings) : () => undefined;
    unregisterHandlers = () => { unregisterShellHandlers(); unregisterImportHandlers(); unregisterAccountHandlers(); unregisterLedgerHandlers(); unregisterFinanceHandlers(); unregisterActivityHandlers(); unregisterLlmHandlers(); unregisterLlmAnalysisHandlers(); };
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
