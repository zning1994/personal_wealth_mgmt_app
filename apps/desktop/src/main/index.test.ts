import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  app,
  ipcMain,
  session,
  utilityProcess,
  createMainWindow,
  installWindowSecurity,
  createUtilityPort,
  registerCommandHandlers,
  taskCoordinator,
} = vi.hoisted(() => {
  const coordinator = { start: vi.fn(), cancel: vi.fn(), dispose: vi.fn() };
  return {
    app: { getAppPath: vi.fn(), whenReady: vi.fn(), once: vi.fn() },
    ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
    session: { defaultSession: {} },
    utilityProcess: { fork: vi.fn() },
    createMainWindow: vi.fn(),
    installWindowSecurity: vi.fn(),
    createUtilityPort: vi.fn(),
    registerCommandHandlers: vi.fn(),
    taskCoordinator: vi.fn(() => coordinator),
  };
});

vi.mock("electron", () => ({ app, ipcMain, session, utilityProcess }));
vi.mock("./window", () => ({ createMainWindow }));
vi.mock("./window-security", () => ({ installWindowSecurity }));
vi.mock("./utility-port", () => ({ createUtilityPort }));
vi.mock("./ipc", () => ({ registerCommandHandlers }));
vi.mock("./task-coordinator", () => ({ TaskCoordinator: taskCoordinator }));

import { startDesktop } from "./index";

describe("startDesktop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    app.getAppPath.mockReturnValue("/app");
    app.whenReady.mockResolvedValue(undefined);
    const child = { kill: vi.fn() };
    utilityProcess.fork.mockReturnValue(child);
    createUtilityPort.mockReturnValue({ dispose: vi.fn() });
    createMainWindow.mockReturnValue({
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    });
    registerCommandHandlers.mockReturnValue(vi.fn());
  });

  it("installs security before creating one window and one bundled utility worker", async () => {
    const ordering: string[] = [];
    installWindowSecurity.mockImplementation(() => ordering.push("security"));
    utilityProcess.fork.mockImplementation(() => {
      ordering.push("fork");
      return { kill: vi.fn() };
    });
    createMainWindow.mockImplementation(() => {
      ordering.push("window");
      return { isDestroyed: () => false, webContents: { send: vi.fn() } };
    });

    await startDesktop();

    expect(app.whenReady).toHaveBeenCalledOnce();
    expect(utilityProcess.fork).toHaveBeenCalledOnce();
    expect(ordering).toEqual(["security", "fork", "window"]);
    expect(registerCommandHandlers).toHaveBeenCalledOnce();
    expect(app.once).toHaveBeenCalledWith("before-quit", expect.any(Function));
  });
});
