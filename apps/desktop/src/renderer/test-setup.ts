import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import type { DesktopShellApi } from "../preload/api";

export function installWealthApi(api: Readonly<DesktopShellApi>): void {
  Object.defineProperty(window, "wealth", {
    configurable: true,
    value: Object.freeze(api),
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "wealth");
});
