import { defineConfig } from "vite";
export default defineConfig({
  root: ".",
  base: process.env.VITE_BASE || "/",
  server: {
    port: 5174,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
  build: { target: "es2020", outDir: "dist", sourcemap: true },
});
