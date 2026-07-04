import type { RunningProxy } from "@megasaver/llm-proxy";
import { describe, expect, it, vi } from "vitest";
import { bindWithRetry } from "../../../src/commands/proxy/bind-with-retry.js";

const RUNNING: RunningProxy = {
  url: "http://127.0.0.1:8787",
  port: 8787,
  close: () => Promise.resolve(),
};

const eaddrinuse = (): NodeJS.ErrnoException => {
  const e = new Error("listen EADDRINUSE: address already in use 127.0.0.1:8787");
  (e as NodeJS.ErrnoException).code = "EADDRINUSE";
  return e;
};

const neverSleep = () => Promise.resolve();

describe("bindWithRetry", () => {
  it("returns listening when the bind succeeds first try (happy path)", async () => {
    const startServer = vi.fn(() => Promise.resolve(RUNNING));
    const out = await bindWithRetry({
      startServer,
      sleep: neverSleep,
      port: 8787,
    });
    expect(out).toEqual({ kind: "listening", running: RUNNING });
    expect(startServer).toHaveBeenCalledTimes(1);
  });

  it("retries the release race: EADDRINUSE on attempt 1, then listens", async () => {
    let calls = 0;
    const startServer = vi.fn(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(eaddrinuse()) : Promise.resolve(RUNNING);
    });
    const out = await bindWithRetry({
      startServer,
      sleep: neverSleep,
      port: 8787,
    });
    expect(out).toEqual({ kind: "listening", running: RUNNING });
    expect(startServer).toHaveBeenCalledTimes(2);
  });

  // Mutation guard: maxAttempts=1 makes the release-race case fail (proves the
  // retry is load-bearing, not incidental).
  it("with maxAttempts=1 an EADDRINUSE on attempt 1 is already-in-use (no retry)", async () => {
    const startServer = vi.fn(() => Promise.reject(eaddrinuse()));
    const out = await bindWithRetry({
      startServer,
      sleep: neverSleep,
      port: 8787,
      maxAttempts: 1,
    });
    expect(out).toEqual({ kind: "already-in-use" });
    expect(startServer).toHaveBeenCalledTimes(1);
  });

  it("returns already-in-use when EADDRINUSE persists across every attempt", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const startServer = vi.fn(() => Promise.reject(eaddrinuse()));
    const out = await bindWithRetry({
      startServer,
      sleep,
      port: 8787,
      maxAttempts: 3,
    });
    expect(out).toEqual({ kind: "already-in-use" });
    expect(startServer).toHaveBeenCalledTimes(3);
    // 3 attempts → 2 inter-attempt sleeps, none after the final failure.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("rethrows a non-EADDRINUSE bind error (never swallowed as already-in-use)", async () => {
    const boom = new Error("EACCES: permission denied");
    (boom as NodeJS.ErrnoException).code = "EACCES";
    await expect(
      bindWithRetry({
        startServer: () => Promise.reject(boom),
        sleep: neverSleep,
        port: 8787,
      }),
    ).rejects.toBe(boom);
  });
});
