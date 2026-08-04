import type { DesktopShellApi } from "../preload/api";

declare global {
  interface Window {
    wealth: DesktopShellApi;
  }
}

export {};
