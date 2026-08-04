import { describe, expect, it, vi } from "vitest";

const { startDesktop, app } = vi.hoisted(() => ({ startDesktop: vi.fn().mockResolvedValue(undefined), app: { exit: vi.fn() } }));
vi.mock("./index", () => ({ startDesktop }));
vi.mock("electron", () => ({ app }));

import "./bootstrap";

describe("production bootstrap", () => {
  it("starts the desktop exactly once", () => {
    expect(startDesktop).toHaveBeenCalledOnce();
  });
});
