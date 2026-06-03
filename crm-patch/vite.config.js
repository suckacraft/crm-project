import { defineConfig } from "vite";

// Same toolchain the quote-parser uses, so the two line up at merge time.
// The /api proxy block only matters once the parser + serverless proxy are in.
export default defineConfig({
  root: ".",
  base: process.env.VITE_BASE || "/",
  server: {
    port: 5174,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
  build: { target: "es2020", outDir: "dist", sourcemap: true },
});
