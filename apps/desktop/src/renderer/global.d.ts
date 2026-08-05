import type { DesktopShellApi } from "../preload/api";

declare global {
  interface Window {
    readonly wealth: Readonly<DesktopShellApi>;
  }
}

export {};
