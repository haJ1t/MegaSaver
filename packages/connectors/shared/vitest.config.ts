import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Repo-standard budget; these three connectors were the last workspace
    // packages on vitest's 5s default. See
    // docs/superpowers/specs/2026-07-25-connector-test-timeout-design.md
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["test/**/*.test.ts", "test/**/*.test-d.ts"],
    typecheck: {
      enabled: true,
      include: ["test/**/*.test-d.ts"],
      tsconfig: "./tsconfig.test-d.json",
    },
  },
});
