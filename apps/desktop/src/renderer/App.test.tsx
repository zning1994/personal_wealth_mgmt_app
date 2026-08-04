// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import type { AppInfo } from "@pwm/contracts";
import { describe, expect, it, vi } from "vitest";
import type { DesktopShellApi } from "../preload/api";
import { App } from "./App";
import { installWealthApi } from "./test-setup";

function createApi(
  getAppInfo: DesktopShellApi["getAppInfo"],
): Readonly<DesktopShellApi> {
  return {
    getAppInfo,
    startTask: vi.fn(),
    cancelTask: vi.fn(),
    onTaskProgress: vi.fn(() => vi.fn()),
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

    expect(screen.getByRole("main")).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 1, name: "个人财富" }),
    ).toBeVisible();
    expect(screen.getByText("本地数据默认保持在此设备上")).toBeVisible();
    expect(screen.getByRole("status", { name: "本机状态" })).toHaveTextContent(
      "正在确认本机应用",
    );
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
      screen.getByRole("heading", { level: 1, name: "Personal Wealth" }),
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
});
