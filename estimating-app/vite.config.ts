import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
    }
  ],
  build: {
    outDir: "../estimating",
    emptyOutDir: true,
    sourcemap: false,
  },
});
