import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    css: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: "jsdom",
    globals: false,
    include: ["test/**/*.test.ts", "test/**/*.test.tsx", "test/**/*.test-d.ts"],
    typecheck: {
      enabled: true,
      include: ["test/**/*.test-d.ts"],
      tsconfig: "./tsconfig.test-d.json",
    },
  },
});
