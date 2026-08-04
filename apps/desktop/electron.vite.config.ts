import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

const fromDesktopRoot = (...segments: string[]): string =>
  resolve(import.meta.dirname, ...segments);

export default defineConfig({
  main: {
    build: {
      outDir: fromDesktopRoot("out"),
      emptyOutDir: true,
      externalizeDeps: false,
      rollupOptions: {
        input: {
          "main/index": fromDesktopRoot("src/main/bootstrap.ts"),
          "worker/index": fromDesktopRoot("src/worker/index.ts"),
        },
        external: ["electron", /^electron\//, /\.node$/],
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name]-[hash].js",
        },
      },
    },
  },
  preload: {
    build: {
      outDir: fromDesktopRoot("out/preload"),
      emptyOutDir: true,
      externalizeDeps: false,
      rollupOptions: {
        input: { index: fromDesktopRoot("src/preload/index.ts") },
        external: ["electron", /^electron\//, /\.node$/],
        output: {
          format: "cjs",
          entryFileNames: "index.js",
          chunkFileNames: "chunks/[name]-[hash].js",
        },
      },
    },
  },
  renderer: {
    root: fromDesktopRoot(),
    base: "./",
    build: {
      outDir: fromDesktopRoot("out/renderer"),
      emptyOutDir: true,
      rollupOptions: {
        input: fromDesktopRoot("index.html"),
      },
    },
  },
});
