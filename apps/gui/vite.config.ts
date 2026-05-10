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
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2023",
  },
});
