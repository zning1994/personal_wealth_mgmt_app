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
    "accounts", "activity", "cancelTask", "finance", "getAppInfo", "imports", "ledger", "llm", "onTaskProgress", "startTask", "workspace",
  ]);
  const workspaceId = await page.evaluate(() => window.wealth.imports?.getWorkspaceId());
  expect(workspaceId).toMatch(/^[0-9a-f-]{36}$/);
  await expect.poll(() => page.evaluate(() => window.wealth.workspace.status())).toMatchObject({ state: "ready" });
  const llmSettings = await page.evaluate(() => window.wealth.llm?.getSettings());
  expect(llmSettings).toEqual({ providers: [] });

  const completed = await page.evaluate(async () => {
    const progressEvents: Array<{ taskId: string; phase: string }> = [];
    let taskId: Awaited<ReturnType<typeof window.wealth.startTask>>["taskId"] | undefined;
    let resolveTerminal: (() => void) | undefined;
    const terminal = new Promise<void>((resolve) => { resolveTerminal = resolve; });
    const unsubscribe = window.wealth.onTaskProgress((progress) => {
      progressEvents.push(progress);
      if (progress.taskId === taskId && progress.phase === "completed") resolveTerminal?.();
    });
    try {
      const currentTaskId = (await window.wealth.startTask({ kind: "health-check", payload: { echo: "e2e" } })).taskId;
      taskId = currentTaskId;
      if (progressEvents.some((progress) => progress.taskId === currentTaskId && progress.phase === "completed")) {
        resolveTerminal?.();
      }
      await Promise.race([
        terminal,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("health task timed out")), 3_000)),
      ]);
      return {
        taskId: currentTaskId,
        phases: progressEvents.filter((progress) => progress.taskId === currentTaskId).map((progress) => progress.phase),
      };
    } finally {
      unsubscribe();
    }
  });
  expect(completed.taskId).toMatch(/^[0-9a-f-]{36}$/);
  expect(completed.phases).toEqual(["running", "completed"]);

  const cancelled = await page.evaluate(async () => {
    const progressEvents: Array<{ taskId: string; phase: string }> = [];
    let taskId: Awaited<ReturnType<typeof window.wealth.startTask>>["taskId"] | undefined;
    let resolveTerminal: (() => void) | undefined;
    const terminal = new Promise<void>((resolve) => { resolveTerminal = resolve; });
    const unsubscribe = window.wealth.onTaskProgress((progress) => {
      progressEvents.push(progress);
      if (progress.taskId === taskId && progress.phase === "cancelled") resolveTerminal?.();
    });
    try {
      const currentTaskId = (await window.wealth.startTask({ kind: "health-check", payload: { echo: "cancel" } })).taskId;
      taskId = currentTaskId;
      const first = await window.wealth.cancelTask({ taskId: currentTaskId });
      if (progressEvents.some((progress) => progress.taskId === currentTaskId && progress.phase === "cancelled")) {
        resolveTerminal?.();
      }
      await Promise.race([
        terminal,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("cancel task timed out")), 3_000)),
      ]);
      let last = first;
      for (let attempt = 0; attempt < 100 && last.cancelled; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        last = await window.wealth.cancelTask({ taskId: currentTaskId });
      }
      return {
        first,
        last,
        taskId: currentTaskId,
        phases: progressEvents.filter((progress) => progress.taskId === currentTaskId).map((progress) => progress.phase),
      };
    } finally {
      unsubscribe();
    }
  });
  expect(cancelled.taskId).toMatch(/^[0-9a-f-]{36}$/);
  expect(cancelled.first).toEqual({ cancelled: true });
  expect(cancelled.last).toEqual({ cancelled: false });
  expect(cancelled.phases).toContain("running");
  expect(cancelled.phases).toContain("cancelled");
  expect(cancelled.phases).not.toContain("completed");
}
