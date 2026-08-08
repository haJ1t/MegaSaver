import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // windows-latest failed three of these 48 files during module COLLECTION,
    // with zero failing assertions:
    //
    //   Error: [vitest-worker]: Timeout calling "fetch" with ["/src/lm1-paths.ts","ssr"]
    //   Test Files 3 failed | 45 passed   Tests 335 passed | 0 failed
    //
    // Which files tripped shifted between runs, so it was a timeout under
    // pressure rather than anything about those modules. The pressure is
    // transform: 382 s on the Windows runner against 886 ms on macOS for the
    // same files. Workers starve the main thread's transform, and their SSR
    // module fetches time out behind it.
    //
    // `pool: "forks"` was tried first and DID clear the timeouts — but it broke
    // lm2-vector-store-quota, which pins a ledger to a lock file's device+inode.
    // Windows `statSync().ino` is not stable across processes, so per-process
    // workers read their own ledger as invalid ("expected 'invalid' to be
    // 'ready'"). Isolation topology is therefore not safe to change here.
    //
    // Capping workers on CI instead keeps the threads pool and its shared
    // process, and cuts both the duplicated transform and the number of module
    // fetches queued behind it. Left uncapped locally, where transform is
    // three orders of magnitude cheaper and the parallelism is worth having.
    // Both bounds, not just the max: vitest derives minThreads from the core
    // count, and a max below it raises "options.minThreads and
    // options.maxThreads must not conflict".
    ...(process.env.CI ? { poolOptions: { threads: { minThreads: 1, maxThreads: 2 } } } : {}),
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
