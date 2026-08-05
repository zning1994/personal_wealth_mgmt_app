// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { AppInfo } from "@pwm/contracts";
import { describe, expect, it, vi } from "vitest";
import type { DesktopShellApi } from "../preload/api";
import { App } from "./App";
import { createI18n } from "./i18n";
import { installWealthApi } from "./test-setup";

vi.mock("./i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./i18n")>();
  return { ...actual, createI18n: vi.fn(actual.createI18n) };
});

const createI18nMock = vi.mocked(createI18n);

function createApi(
  getAppInfo: DesktopShellApi["getAppInfo"],
): Readonly<DesktopShellApi> {
  return {
    getAppInfo,
    startTask: vi.fn(),
    cancelTask: vi.fn(),
    onTaskProgress: vi.fn(() => vi.fn()),
    workspace: {
      status: vi.fn().mockResolvedValue({ state: "ready" }),
      unlock: vi.fn(),
      enableAppLock: vi.fn(),
      disableAppLock: vi.fn(),
      createBackup: vi.fn(),
      restoreBackup: vi.fn(),
    },
  };
}

describe("App", () => {
  it("renders the accessible Chinese shell and reads app info only through preload", async () => {
    const api = createApi(
      vi.fn().mockResolvedValue({
        name: "Personal Wealth",
        version: "0.1.0",
        platform: "darwin",
      }),
    );
    installWealthApi(api);

    render(<App locale="zh-CN" />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "个人财富" }),
    ).toBeVisible();
    expect(screen.getByText("本地数据默认保持在此设备上")).toBeVisible();
    expect(await screen.findByText("本机应用已安全启动")).toBeVisible();
    expect(screen.getByLabelText("应用版本")).toHaveTextContent("0.1.0");
    expect(api.getAppInfo).toHaveBeenCalledOnce();
    expect(api.startTask).not.toHaveBeenCalled();
    expect(api.cancelTask).not.toHaveBeenCalled();
    expect(api.onTaskProgress).not.toHaveBeenCalled();
  });

  it("renders stable English copy and semantic preparation guidance", async () => {
    installWealthApi(
      createApi(
        vi.fn().mockResolvedValue({
          name: "Personal Wealth",
          version: "0.1.0",
          platform: "win32",
        }),
      ),
    );

    render(<App locale="en" />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Personal Wealth" }),
    ).toBeVisible();
    expect(
      screen.getByText("Your data stays on this device by default"),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Bring your statements here next",
      }),
    ).toBeVisible();
    expect(
      await screen.findByText("The local app started safely"),
    ).toBeVisible();
  });

  it("keeps encrypted-backup recovery available when the workspace key is missing", async () => {
    const api = createApi(vi.fn().mockResolvedValue({ name: "Personal Wealth", version: "0.1.0", platform: "darwin" }));
    api.workspace.status = vi.fn().mockResolvedValue({ state: "recovery", workspaceId: crypto.randomUUID() as never });
    api.workspace.restoreBackup = vi.fn().mockResolvedValue({ workspaceId: crypto.randomUUID(), accountCount: 1, journalCount: 2, objectCount: 0, fxQuoteCount: 0 });
    installWealthApi(api);

    render(<App locale="en" />);

    expect(await screen.findByRole("heading", { name: "Recovery is required" })).toBeVisible();
    const password = screen.getByLabelText("Backup password");
    fireEvent.change(password, { target: { value: "recovery-pass" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Restore encrypted backup" })); });
    expect(api.workspace.restoreBackup).toHaveBeenCalledWith({ password: "recovery-pass" });
    expect(await screen.findByText(/restored with 2 ledger entries/u)).toBeVisible();
  });

  it("turns app-info failure into useful localized guidance without exposing the error", async () => {
    installWealthApi(
      createApi(vi.fn().mockRejectedValue(new Error("secret filesystem path"))),
    );

    render(<App locale="zh-CN" />);

    expect(await screen.findByText("无法确认应用状态")).toBeVisible();
    expect(
      screen.getByText("请重新启动应用后再试。你的本地数据没有被发送。"),
    ).toBeVisible();
    expect(
      screen.queryByText(/secret filesystem path/),
    ).not.toBeInTheDocument();
  });

  it("does not update or emit an act warning after unmount", async () => {
    let resolveInfo: ((value: AppInfo) => void) | undefined;
    const pending = new Promise<AppInfo>((resolve) => {
      resolveInfo = resolve;
    });
    installWealthApi(createApi(vi.fn(() => pending)));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const view = render(<App locale="en" />);

    view.unmount();
    await act(async () => {
      resolveInfo?.({
        name: "Personal Wealth",
        version: "0.1.0",
        platform: "darwin",
      });
      await pending;
    });

    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("act("),
    );
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("reuses locale state on same-locale rerenders and switches intentionally", async () => {
    createI18nMock.mockClear();
    const api = createApi(
      vi.fn().mockResolvedValue({
        name: "Personal Wealth",
        version: "0.1.0",
        platform: "darwin",
      }),
    );
    installWealthApi(api);
    const view = render(<App locale="en" />);

    expect(
      await screen.findByText("The local app started safely"),
    ).toBeVisible();
    const initialInstanceCount = createI18nMock.mock.calls.length;
    expect(initialInstanceCount).toBeGreaterThan(0);

    view.rerender(<App locale="en" />);

    expect(createI18nMock).toHaveBeenCalledTimes(initialInstanceCount);
    expect(screen.getByText("The local app started safely")).toBeVisible();
    expect(api.getAppInfo).toHaveBeenCalledOnce();

    view.rerender(<App locale="zh-CN" />);

    expect(createI18nMock.mock.calls.length).toBeGreaterThan(
      initialInstanceCount,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "个人财富" }),
    ).toBeVisible();
  });

  it("does not accumulate locale or preload work across StrictMode rerenders", async () => {
    createI18nMock.mockClear();
    const api = createApi(
      vi.fn().mockResolvedValue({
        name: "Personal Wealth",
        version: "0.1.0",
        platform: "win32",
      }),
    );
    installWealthApi(api);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const renderStrictApp = () => (
      <StrictMode>
        <App locale="en" />
      </StrictMode>
    );
    const view = render(renderStrictApp());

    expect(
      await screen.findByText("The local app started safely"),
    ).toBeVisible();
    const initialInstanceCount = createI18nMock.mock.calls.length;
    const initialPreloadCount = vi.mocked(api.getAppInfo).mock.calls.length;
    expect(initialInstanceCount).toBeGreaterThan(0);
    expect(initialPreloadCount).toBeGreaterThan(0);

    view.rerender(renderStrictApp());

    expect(createI18nMock).toHaveBeenCalledTimes(initialInstanceCount);
    expect(api.getAppInfo).toHaveBeenCalledTimes(initialPreloadCount);
    view.unmount();
    await act(async () => Promise.resolve());
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
