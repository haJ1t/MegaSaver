import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const BRIDGE_PORT = process.env.MEGASAVER_GUI_BRIDGE_PORT ?? "5174";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${BRIDGE_PORT}`,
        changeOrigin: false,
      },
    },
  },
  // Expose the dev-only shared bridge token to the frontend. VITE_-prefixed env
  // vars are read from process.env at build time; defining it explicitly keeps
  // the packaged build (where it is unset) inlining an empty string, so the app
  // falls through to the ?token= bootstrap instead of a stale value.
  define: {
    "import.meta.env.VITE_MEGASAVER_GUI_TOKEN": JSON.stringify(
      process.env.VITE_MEGASAVER_GUI_TOKEN ?? "",
    ),
  },
  build: {
    outDir: "dist",
    // No sourcemaps in the shipped bundle: dev debugging uses the vite dev
    // server, and the 2.7 MB .map would bloat the published CLI tarball.
    sourcemap: false,
    target: "es2023",
    // Main entry is 796 kB (cytoscape + app) + 529 kB async three.js universe.
    // three is already isolated via React.lazy in memory-universe-tab.tsx:6;
    // cytoscape is intentionally extracted for independent browser caching.
    // 800 kB silences the default 500 kB warning without hiding true regressions.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          cytoscape: ["cytoscape"],
        },
      },
    },
  },
});
