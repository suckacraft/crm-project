import { defineConfig } from "vite";

// Modern build toolchain for the POC — and the toolchain the merged crm-project
// will adopt under "full modernization". index.html is the entry; ./src/app.js
// is its module graph. XLSX + pdf.js stay as CDN <script> globals (loaded in
// index.html), so they are NOT bundled — declared external below for clarity.
//
// Dev server proxies /api → the key-holding proxy (proxy/server.js on :8787),
// so `npm run dev` (app) + `npm run proxy` (LLM) is the full local stack.
export default defineConfig({
  root: ".",
  // "/" for root deploys (Vercel/Netlify/Cloudflare). For GitHub Pages under a
  // subpath set VITE_BASE=/<repo>/ in the build env (the Pages workflow does this).
  base: process.env.VITE_BASE || "/",
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: true,
  },
});
