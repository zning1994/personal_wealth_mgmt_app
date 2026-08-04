import { expect, type Page } from "@playwright/test";

export async function assertDesktopAcceptance(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "个人财富" })).toBeVisible();
  await expect(page.getByRole("status", { name: "本机状态" })).toContainText("本机应用已安全启动");
  const info = await page.evaluate(() => window.wealth.getAppInfo());
  expect(info.name).toBe("Personal Wealth");
  expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(["darwin", "win32"]).toContain(info.platform);
  await expect(page.getByLabel("应用版本")).toHaveText(info.version);
  expect(await page.evaluate(() => typeof globalThis.process)).toBe("undefined");
  expect(await page.evaluate(() => Object.keys(window.wealth).sort())).toEqual([
    "cancelTask", "getAppInfo", "onTaskProgress", "startTask",
  ]);

  const completed = await page.evaluate(async () => {
    const phases: string[] = [];
    let taskId = "";
    let resolveTerminal: (() => void) | undefined;
    const terminal = new Promise<void>((resolve) => { resolveTerminal = resolve; });
    const unsubscribe = window.wealth.onTaskProgress((progress) => {
      if (progress.taskId !== taskId) return;
      phases.push(progress.phase);
      if (progress.phase === "completed") resolveTerminal?.();
    });
    try {
      taskId = (await window.wealth.startTask({ kind: "health-check", payload: { echo: "e2e" } })).taskId;
      await Promise.race([
        terminal,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("health task timed out")), 3_000)),
      ]);
      return { taskId, phases };
    } finally {
      unsubscribe();
    }
  });
  expect(completed.taskId).toMatch(/^[0-9a-f-]{36}$/);
  expect(completed.phases).toEqual(["running", "completed"]);

  const cancelled = await page.evaluate(async () => {
    const { taskId } = await window.wealth.startTask({ kind: "health-check", payload: { echo: "cancel" } });
    const first = await window.wealth.cancelTask({ taskId });
    let last = first;
    for (let attempt = 0; attempt < 100 && last.cancelled; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      last = await window.wealth.cancelTask({ taskId });
    }
    return { first, last, taskId };
  });
  expect(cancelled.taskId).toMatch(/^[0-9a-f-]{36}$/);
  expect(cancelled.first).toEqual({ cancelled: true });
  expect(cancelled.last).toEqual({ cancelled: false });
}
