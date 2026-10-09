import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {readFileSync,statSync,writeFileSync} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const portalRoot = resolve(configDirectory, "..");

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
      name: "jgc-current-offline-assets",
      writeBundle(_options, bundle) {
        const workerPath=resolve(portalRoot,"service-worker.js"),worker=readFileSync(workerPath,"utf8");
        const match=worker.match(/const JGC_APP_SHELL = \[([\s\S]*?)\];/);
        if(!match)throw new Error("The Portal offline asset list is missing.");
        const previous=JSON.parse("["+match[1]+"]") as string[];
        const current=Object.keys(bundle).filter(file=>file.startsWith("assets/")).sort().map(file=>"./estimating/"+file);
        const shell=[...previous.filter(file=>!file.startsWith("./estimating/assets/")),...current];
        const bytes=shell.reduce((sum,file)=>sum+statSync(resolve(portalRoot,file.split("?")[0])).size,0);
        if(shell.length>300||bytes>32*1024*1024)throw new Error("The current offline release exceeds its 300-file / 32 MB cache budget.");
        writeFileSync(workerPath,worker.replace(match[0],"const JGC_APP_SHELL = "+JSON.stringify(shell,null,2)+";"));
        console.info(`JGC current offline shell: ${shell.length} files, ${(bytes/1024/1024).toFixed(2)} MB.`);
      }
    }
  ],
  build: {
    outDir: "../estimating",
    // Keep old published URLs available for already-open clients. Cache generation uses
    // this build's manifest; historical bundles are never copied into memory or precached.
    emptyOutDir: false,
    manifest: true,
    sourcemap: false,
  },
});
