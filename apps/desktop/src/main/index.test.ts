import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  app,
  ipcMain,
  session,
  utilityProcess,
  createMainWindow,
  installWindowSecurity,
  createUtilityPort,
  installApplicationProtocol,
  registerCommandHandlers,
  taskCoordinator,
  coordinators,
} = vi.hoisted(() => {
  const coordinators: Array<{
    start: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }> = [];
  return {
    app: {
      getAppPath: vi.fn(),
      getVersion: vi.fn(),
      whenReady: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      setAppUserModelId: vi.fn(),
    },
    ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
    session: { defaultSession: {} },
    utilityProcess: { fork: vi.fn() },
    createMainWindow: vi.fn(),
    installWindowSecurity: vi.fn(),
    createUtilityPort: vi.fn(),
    installApplicationProtocol: vi.fn(),
    registerCommandHandlers: vi.fn(),
    taskCoordinator: vi.fn(() => {
      const coordinator = { start: vi.fn(), cancel: vi.fn(), dispose: vi.fn() };
      coordinators.push(coordinator);
      return coordinator;
    }),
    coordinators,
  };
});

vi.mock("electron", () => ({ app, ipcMain, session, utilityProcess }));
vi.mock("./window", () => ({ createMainWindow }));
vi.mock("./window-security", () => ({ installWindowSecurity }));
vi.mock("./utility-port", () => ({ createUtilityPort }));
vi.mock("./app-protocol", () => ({
  APPLICATION_ENTRY_URL: "app://desktop/index.html",
  APPLICATION_ORIGIN: "app://desktop",
  installApplicationProtocol,
}));
vi.mock("./ipc", () => ({ registerCommandHandlers }));
vi.mock("./task-coordinator", () => ({ TaskCoordinator: taskCoordinator }));

function childDouble() {
  return { kill: vi.fn() };
}

function portDouble(ready: Promise<void> = Promise.resolve()) {
  return { dispose: vi.fn(), ready: vi.fn(() => ready) };
}

function windowDouble() {
  let destroyed = false;
  const listeners = new Map<string, Set<() => void>>();
  const once = vi.fn((event: string, listener: () => void) => {
    const wrapped = () => {
      listeners.get(event)?.delete(wrapped);
      listener();
    };
    const eventListeners = listeners.get(event) ?? new Set();
    eventListeners.add(wrapped);
    listeners.set(event, eventListeners);
  });
  const off = vi.fn((event: string, listener: () => void) => {
    listeners.get(event)?.delete(listener);
  });
  return {
    destroy: vi.fn(() => {
      destroyed = true;
    }),
    isDestroyed: vi.fn(() => destroyed),
    webContents: { send: vi.fn() },
    once,
    off,
    emit(event: string) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener();
    },
  };
}

async function loadStartDesktop() {
  return (await import("./index")).startDesktop;
}

function beforeQuitCallback(): () => void {
  const callback = app.once.mock.calls.find(
    ([event]) => event === "before-quit",
  )?.[1] as (() => void) | undefined;
  expect(callback).toBeTypeOf("function");
  return callback as () => void;
}

describe("startDesktop", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    coordinators.splice(0);
    app.getAppPath.mockReturnValue("/app");
    app.getVersion.mockReturnValue("0.1.1");
    app.whenReady.mockResolvedValue(undefined);
    app.once.mockImplementation(() => undefined);
    utilityProcess.fork.mockImplementation(() => childDouble());
    createUtilityPort.mockImplementation(() => portDouble());
    createMainWindow.mockImplementation(() => windowDouble());
    registerCommandHandlers.mockImplementation(() => vi.fn());
  });

  it("does not create handlers or a window before the utility process is ready", async () => {
    const ordering: string[] = [];
    let resolveReady: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    installWindowSecurity.mockImplementation(() => ordering.push("security"));
    utilityProcess.fork.mockImplementation(() => {
      ordering.push("fork");
      return childDouble();
    });
    createMainWindow.mockImplementation(() => {
      ordering.push("window");
      return windowDouble();
    });
    createUtilityPort.mockReturnValue(portDouble(ready));
    const startDesktop = await loadStartDesktop();

    const starting = startDesktop();
    await vi.waitFor(() => expect(createUtilityPort).toHaveBeenCalledOnce());

    expect(taskCoordinator).not.toHaveBeenCalled();
    expect(registerCommandHandlers).not.toHaveBeenCalled();
    expect(createMainWindow).not.toHaveBeenCalled();
    expect(ordering).toEqual(["security", "fork"]);

    resolveReady?.();
    await starting;
    expect(taskCoordinator).toHaveBeenCalledOnce();
    expect(registerCommandHandlers).toHaveBeenCalledOnce();
    expect(createMainWindow).toHaveBeenCalledOnce();
    expect(ordering).toEqual(["security", "fork", "window"]);
  });

  it("installs the fixed app identity, protocol root, and bundled runtime paths", async () => {
    const startDesktop = await loadStartDesktop();

    await startDesktop();

    expect(app.setAppUserModelId).toHaveBeenCalledWith(
      "com.personalwealth.desktop",
    );
    expect(installApplicationProtocol).toHaveBeenCalledWith(
      "/app/out/renderer",
    );
    expect(installWindowSecurity).toHaveBeenCalledWith(
      session.defaultSession,
      "app://desktop",
    );
    expect(utilityProcess.fork).toHaveBeenCalledWith(
      "/app/out/worker/index.js",
    );
    expect(createMainWindow).toHaveBeenCalledWith({
      preloadPath: "/app/out/preload/index.js",
      rendererUrl: "app://desktop/index.html",
    });
  });

  it("resolves sibling output entries when Electron launches the built main file directly", async () => {
    app.getAppPath.mockReturnValue("/app/out/main");
    const startDesktop = await loadStartDesktop();

    await startDesktop();

    expect(installApplicationProtocol).toHaveBeenCalledWith(
      "/app/out/renderer",
    );
    expect(utilityProcess.fork).toHaveBeenCalledWith(
      "/app/out/worker/index.js",
    );
    expect(createMainWindow).toHaveBeenCalledWith({
      preloadPath: "/app/out/preload/index.js",
      rendererUrl: "app://desktop/index.html",
    });
  });

  it("resolves bundled entries inside an asar package", async () => {
    app.getAppPath.mockReturnValue(
      "/Applications/Personal Wealth.app/Contents/Resources/app.asar",
    );
    const startDesktop = await loadStartDesktop();

    await startDesktop();

    const asarRoot =
      "/Applications/Personal Wealth.app/Contents/Resources/app.asar/out";
    expect(installApplicationProtocol).toHaveBeenCalledWith(
      `${asarRoot}/renderer`,
    );
    expect(utilityProcess.fork).toHaveBeenCalledWith(
      `${asarRoot}/worker/index.js`,
    );
    expect(createMainWindow).toHaveBeenCalledWith({
      preloadPath: `${asarRoot}/preload/index.js`,
      rendererUrl: "app://desktop/index.html",
    });
  });

  it("times out at 5000ms, clears resources and timers, and never creates downstream state", async () => {
    vi.useFakeTimers();
    try {
      const child = childDouble();
      const port = portDouble(new Promise<void>(() => undefined));
      const retryChild = childDouble();
      const retryPort = portDouble();
      utilityProcess.fork
        .mockReturnValueOnce(child)
        .mockReturnValueOnce(retryChild);
      createUtilityPort
        .mockReturnValueOnce(port)
        .mockReturnValueOnce(retryPort);
      const startDesktop = await loadStartDesktop();

      const starting = startDesktop();
      const rejected = expect(starting).rejects.toThrow(
        "Utility process readiness timed out",
      );
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(4_999);
      expect(child.kill).not.toHaveBeenCalled();
      expect(port.dispose).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await rejected;

      expect(port.dispose).toHaveBeenCalledOnce();
      expect(child.kill).toHaveBeenCalledOnce();
      expect(taskCoordinator).not.toHaveBeenCalled();
      expect(registerCommandHandlers).not.toHaveBeenCalled();
      expect(createMainWindow).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);

      await expect(startDesktop()).resolves.toBeUndefined();
      expect(utilityProcess.fork).toHaveBeenCalledTimes(2);
      expect(retryChild.kill).not.toHaveBeenCalled();
      expect(retryPort.dispose).not.toHaveBeenCalled();
      expect(taskCoordinator).toHaveBeenCalledOnce();
      expect(registerCommandHandlers).toHaveBeenCalledOnce();
      expect(createMainWindow).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans an early utility readiness rejection and retries with a fresh child in the same module", async () => {
    const failedChild = childDouble();
    let rejectReady: ((error: Error) => void) | undefined;
    const failedReady = new Promise<void>((_resolve, reject) => {
      rejectReady = reject;
    });
    const failedPort = portDouble(failedReady);
    const healthyChild = childDouble();
    const healthyPort = portDouble();
    utilityProcess.fork
      .mockReturnValueOnce(failedChild)
      .mockReturnValueOnce(healthyChild);
    createUtilityPort
      .mockReturnValueOnce(failedPort)
      .mockReturnValueOnce(healthyPort);
    const startDesktop = await loadStartDesktop();

    const firstStart = startDesktop();
    const rejected = expect(firstStart).rejects.toThrow(
      "Utility process transport is unavailable",
    );
    rejectReady?.(new Error("Utility process transport is unavailable"));
    await rejected;
    expect(failedPort.dispose).toHaveBeenCalledOnce();
    expect(failedChild.kill).toHaveBeenCalledOnce();
    expect(taskCoordinator).not.toHaveBeenCalled();
    expect(registerCommandHandlers).not.toHaveBeenCalled();
    expect(createMainWindow).not.toHaveBeenCalled();

    await expect(startDesktop()).resolves.toBeUndefined();
    expect(utilityProcess.fork).toHaveBeenCalledTimes(2);
    expect(healthyChild.kill).not.toHaveBeenCalled();
    expect(healthyPort.dispose).not.toHaveBeenCalled();
    expect(taskCoordinator).toHaveBeenCalledOnce();
    expect(registerCommandHandlers).toHaveBeenCalledOnce();
    expect(createMainWindow).toHaveBeenCalledOnce();
  });

  it("rolls back a handler-registration failure and retries without downstream or handler accumulation", async () => {
    const failedChild = childDouble();
    const failedPort = portDouble();
    const successfulChild = childDouble();
    const successfulPort = portDouble();
    const successfulUnregister = vi.fn();
    utilityProcess.fork
      .mockReturnValueOnce(failedChild)
      .mockReturnValueOnce(successfulChild);
    createUtilityPort
      .mockReturnValueOnce(failedPort)
      .mockReturnValueOnce(successfulPort);
    registerCommandHandlers
      .mockImplementationOnce(() => {
        throw new Error("registration failed");
      })
      .mockReturnValueOnce(successfulUnregister);
    const startDesktop = await loadStartDesktop();

    await expect(startDesktop()).rejects.toThrow("registration failed");
    expect(coordinators[0]?.dispose).toHaveBeenCalledOnce();
    expect(failedPort.dispose).toHaveBeenCalledOnce();
    expect(failedChild.kill).toHaveBeenCalledOnce();
    expect(createMainWindow).not.toHaveBeenCalled();

    await startDesktop();
    expect(registerCommandHandlers).toHaveBeenCalledTimes(2);
    expect(createMainWindow).toHaveBeenCalledOnce();
    beforeQuitCallback()();
    expect(successfulUnregister).toHaveBeenCalledOnce();
  });

  it("unregisters handlers after window creation fails and a retry installs only one live handler set", async () => {
    const failedChild = childDouble();
    const failedPort = portDouble();
    const successfulChild = childDouble();
    const successfulPort = portDouble();
    const failedUnregister = vi.fn();
    const successfulUnregister = vi.fn();
    utilityProcess.fork
      .mockReturnValueOnce(failedChild)
      .mockReturnValueOnce(successfulChild);
    createUtilityPort
      .mockReturnValueOnce(failedPort)
      .mockReturnValueOnce(successfulPort);
    registerCommandHandlers
      .mockReturnValueOnce(failedUnregister)
      .mockReturnValueOnce(successfulUnregister);
    createMainWindow.mockImplementationOnce(() => {
      throw new Error("window failed");
    });
    const startDesktop = await loadStartDesktop();

    await expect(startDesktop()).rejects.toThrow("window failed");
    expect(failedUnregister).toHaveBeenCalledOnce();
    expect(coordinators[0]?.dispose).toHaveBeenCalledOnce();
    expect(failedPort.dispose).toHaveBeenCalledOnce();
    expect(failedChild.kill).toHaveBeenCalledOnce();

    await startDesktop();
    expect(registerCommandHandlers).toHaveBeenCalledTimes(2);
    beforeQuitCallback()();
    expect(failedUnregister).toHaveBeenCalledOnce();
    expect(successfulUnregister).toHaveBeenCalledOnce();
    expect(successfulPort.dispose).toHaveBeenCalledOnce();
    expect(successfulChild.kill).toHaveBeenCalledOnce();
  });

  it("destroys the live window and all earlier resources when before-quit registration fails", async () => {
    const child = childDouble();
    const port = portDouble();
    const mainWindow = windowDouble();
    const unregister = vi.fn();
    utilityProcess.fork.mockReturnValue(child);
    createUtilityPort.mockReturnValue(port);
    createMainWindow.mockReturnValue(mainWindow);
    registerCommandHandlers.mockReturnValue(unregister);
    app.once.mockImplementation(() => {
      throw new Error("event registration failed");
    });
    const startDesktop = await loadStartDesktop();

    await expect(startDesktop()).rejects.toThrow("event registration failed");

    expect(unregister).toHaveBeenCalledOnce();
    expect(coordinators[0]?.dispose).toHaveBeenCalledOnce();
    expect(port.dispose).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(mainWindow.destroy).toHaveBeenCalledOnce();
  });

  it("publishes progress to a live window and drops it after the window is destroyed", async () => {
    const mainWindow = windowDouble();
    createMainWindow.mockReturnValue(mainWindow);
    const startDesktop = await loadStartDesktop();
    await startDesktop();
    const publish = (taskCoordinator.mock.calls as unknown[][])[0]?.[1] as
      ((progress: unknown) => void) | undefined;
    const progress = {
      taskId: "018f4f7e-8ead-7c0d-8000-000000000301",
      phase: "running",
      completed: 0,
      total: 1,
    };

    publish?.(progress);
    expect(mainWindow.webContents.send).toHaveBeenCalledOnce();
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      "task:progress",
      progress,
    );

    mainWindow.destroy();
    publish?.(progress);
    expect(mainWindow.webContents.send).toHaveBeenCalledOnce();
  });

  it("cleans handlers, coordinator, port, child and window exactly once across repeated quit callbacks", async () => {
    const child = childDouble();
    const port = portDouble();
    const mainWindow = windowDouble();
    const unregister = vi.fn();
    utilityProcess.fork.mockReturnValue(child);
    createUtilityPort.mockReturnValue(port);
    createMainWindow.mockReturnValue(mainWindow);
    registerCommandHandlers.mockReturnValue(unregister);
    const startDesktop = await loadStartDesktop();
    await startDesktop();

    const quit = beforeQuitCallback();
    quit();
    quit();

    expect(unregister).toHaveBeenCalledOnce();
    expect(coordinators[0]?.dispose).toHaveBeenCalledOnce();
    expect(port.dispose).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(mainWindow.destroy).toHaveBeenCalledOnce();
  });

  it("releases the module startup after the only window closes and composes a fresh generation", async () => {
    const firstChild = childDouble();
    const secondChild = childDouble();
    const firstPort = portDouble();
    const secondPort = portDouble();
    const firstWindow = windowDouble();
    const secondWindow = windowDouble();
    const firstUnregister = vi.fn();
    const secondUnregister = vi.fn();
    utilityProcess.fork.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
    createUtilityPort.mockReturnValueOnce(firstPort).mockReturnValueOnce(secondPort);
    createMainWindow.mockReturnValueOnce(firstWindow).mockReturnValueOnce(secondWindow);
    registerCommandHandlers.mockReturnValueOnce(firstUnregister).mockReturnValueOnce(secondUnregister);
    const startDesktop = await loadStartDesktop();

    await startDesktop();
    firstWindow.emit("closed");
    firstWindow.emit("closed");

    expect(firstUnregister).toHaveBeenCalledOnce();
    expect(coordinators[0]?.dispose).toHaveBeenCalledOnce();
    expect(firstPort.dispose).toHaveBeenCalledOnce();
    expect(firstChild.kill).toHaveBeenCalledOnce();
    expect(app.off).toHaveBeenCalledWith("before-quit", expect.any(Function));
    expect(firstWindow.off).toHaveBeenCalledWith("closed", expect.any(Function));

    await startDesktop();
    expect(utilityProcess.fork).toHaveBeenCalledTimes(2);
    expect(createMainWindow).toHaveBeenCalledTimes(2);
    expect(registerCommandHandlers).toHaveBeenCalledTimes(2);
    expect(app.once.mock.calls.filter(([event]) => event === "before-quit")).toHaveLength(2);

    firstWindow.emit("closed");
    await startDesktop();
    expect(utilityProcess.fork).toHaveBeenCalledTimes(2);
    expect(secondUnregister).not.toHaveBeenCalled();
  });

  it("rolls back every resource when awaited initial renderer loading rejects and retries", async () => {
    const failedChild = childDouble();
    const healthyChild = childDouble();
    const failedPort = portDouble();
    const healthyPort = portDouble();
    const unregisterFailed = vi.fn();
    const unregisterHealthy = vi.fn();
    utilityProcess.fork.mockReturnValueOnce(failedChild).mockReturnValueOnce(healthyChild);
    createUtilityPort.mockReturnValueOnce(failedPort).mockReturnValueOnce(healthyPort);
    registerCommandHandlers.mockReturnValueOnce(unregisterFailed).mockReturnValueOnce(unregisterHealthy);
    createMainWindow.mockRejectedValueOnce(new Error("renderer load failed")).mockResolvedValueOnce(windowDouble());
    const startDesktop = await loadStartDesktop();

    await expect(startDesktop()).rejects.toThrow("renderer load failed");
    expect(unregisterFailed).toHaveBeenCalledOnce();
    expect(coordinators[0]?.dispose).toHaveBeenCalledOnce();
    expect(failedPort.dispose).toHaveBeenCalledOnce();
    expect(failedChild.kill).toHaveBeenCalledOnce();

    await expect(startDesktop()).resolves.toBeUndefined();
    expect(utilityProcess.fork).toHaveBeenCalledTimes(2);
    expect(unregisterHealthy).not.toHaveBeenCalled();
  });
});
