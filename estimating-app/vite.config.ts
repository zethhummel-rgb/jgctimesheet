import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const portalRoot = resolve(configDirectory, "..");
const estimatorOutput = resolve(portalRoot, "estimating");
const previousReleaseAssets = new Map<string, Uint8Array>();

try {
  const serviceWorker = readFileSync(resolve(portalRoot, "service-worker.js"), "utf8");
  for (const match of serviceWorker.matchAll(/"\.\/estimating\/assets\/([^"]+)"/g)) {
    const assetName = match[1];
    const assetPath = resolve(estimatorOutput, "assets", assetName);
    if (existsSync(assetPath)) previousReleaseAssets.set(assetName, readFileSync(assetPath));
  }
} catch {
  // A first build has no prior release assets to retain.
}

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "jgc-estimator-theme-marker",
      transformIndexHtml: {
        order: "post",
        handler(html) {
          return html.replace(
            /<link rel="stylesheet" crossorigin href="(\.\/assets\/index-[^"]+\.css)">/,
            '<link rel="stylesheet" crossorigin href="$1" data-jgc-design-system="8" data-jgc-estimator-theme="1">'
          );
        }
      }
    },
    {
      name: "jgc-retain-previous-release-assets",
      closeBundle() {
        for (const [assetName, contents] of previousReleaseAssets) {
          const assetPath = resolve(estimatorOutput, "assets", assetName);
          if (!existsSync(assetPath)) writeFileSync(assetPath, contents);
        }
      }
    }
  ],
  build: {
    outDir: "../estimating",
    emptyOutDir: true,
    sourcemap: false,
  },
});
