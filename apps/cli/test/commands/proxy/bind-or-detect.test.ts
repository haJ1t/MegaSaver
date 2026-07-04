import type { RunningProxy } from "@megasaver/llm-proxy";
import type { ProxyRuntimeState } from "@megasaver/proxy-control";
import { describe, expect, it, vi } from "vitest";
import { bindOrDetectRunning } from "../../../src/commands/proxy/bind-or-detect.js";

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

function runtime(overrides: Partial<ProxyRuntimeState> = {}): ProxyRuntimeState {
  return {
    version: 1,
    pid: 4242,
    processStartToken: "tok",
    bootId: "boot",
    instanceId: "inst-1",
    controlUrl: "http://127.0.0.1:8788",
    controlToken: "ctl",
    healthCapability: "cap-secret",
    proxyUrl: "http://127.0.0.1:8787",
    startedAt: "2026-07-03T00:00:00.000Z",
    lastReconciledAt: "2026-07-03T00:00:00.000Z",
    lastUsagePersistedAt: null,
    ...overrides,
  };
}

const neverSleep = () => Promise.resolve();

describe("bindOrDetectRunning", () => {
  it("returns listening when the bind succeeds first try (happy path)", async () => {
    const startServer = vi.fn(() => Promise.resolve(RUNNING));
    const out = await bindOrDetectRunning({
      startServer,
      readRuntime: () => null,
      probeOurs: () => Promise.resolve(false),
      isLiveOwner: () => false,
      sleep: neverSleep,
      port: 8787,
    });
    expect(out).toEqual({ kind: "listening", running: RUNNING });
    expect(startServer).toHaveBeenCalledTimes(1);
  });

  it("returns already-running when EADDRINUSE and the health probe confirms it is ours", async () => {
    const probeOurs = vi.fn(() => Promise.resolve(true));
    const out = await bindOrDetectRunning({
      startServer: () => Promise.reject(eaddrinuse()),
      readRuntime: () => runtime(),
      probeOurs,
      isLiveOwner: () => false,
      sleep: neverSleep,
      port: 8787,
    });
    expect(out).toEqual({ kind: "already-running", instanceId: "inst-1" });
    expect(probeOurs).toHaveBeenCalledOnce();
  });

  it("uses pid-liveness when the runtime has no health capability", async () => {
    const isLiveOwner = vi.fn(() => true);
    const probeOurs = vi.fn(() => Promise.resolve(false));
    const out = await bindOrDetectRunning({
      startServer: () => Promise.reject(eaddrinuse()),
      readRuntime: () => runtime({ healthCapability: "" }),
      probeOurs,
      isLiveOwner,
      sleep: neverSleep,
      port: 8787,
    });
    expect(out).toEqual({ kind: "already-running", instanceId: "inst-1" });
    expect(isLiveOwner).toHaveBeenCalledOnce();
    expect(probeOurs).not.toHaveBeenCalled();
  });

  it("returns foreign (with a clear message) when EADDRINUSE persists and it is not ours", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const out = await bindOrDetectRunning({
      startServer: () => Promise.reject(eaddrinuse()),
      readRuntime: () => runtime(),
      probeOurs: () => Promise.resolve(false),
      isLiveOwner: () => false,
      sleep,
      port: 8787,
      maxAttempts: 3,
    });
    expect(out.kind).toBe("foreign");
    if (out.kind !== "foreign") throw new Error("expected foreign");
    expect(out.message).toContain("8787");
    expect(out.message).toContain("non-megasaver");
    expect(out.message).toContain("MEGASAVER_PROXY_PORT");
    // 3 attempts → 2 inter-attempt sleeps.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("returns foreign when no runtime state exists (nothing claims ownership)", async () => {
    const out = await bindOrDetectRunning({
      startServer: () => Promise.reject(eaddrinuse()),
      readRuntime: () => null,
      probeOurs: () => Promise.resolve(true),
      isLiveOwner: () => true,
      sleep: neverSleep,
      port: 8787,
    });
    expect(out.kind).toBe("foreign");
  });

  it("retries the release race: EADDRINUSE once, then listens", async () => {
    let calls = 0;
    const startServer = vi.fn(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(eaddrinuse()) : Promise.resolve(RUNNING);
    });
    const out = await bindOrDetectRunning({
      startServer,
      readRuntime: () => null, // not ours → falls through to retry
      probeOurs: () => Promise.resolve(false),
      isLiveOwner: () => false,
      sleep: neverSleep,
      port: 8787,
    });
    expect(out).toEqual({ kind: "listening", running: RUNNING });
    expect(startServer).toHaveBeenCalledTimes(2);
  });

  it("rethrows a non-EADDRINUSE bind error (never swallowed)", async () => {
    const boom = new Error("EACCES: permission denied");
    (boom as NodeJS.ErrnoException).code = "EACCES";
    await expect(
      bindOrDetectRunning({
        startServer: () => Promise.reject(boom),
        readRuntime: () => runtime(),
        probeOurs: () => Promise.resolve(false),
        isLiveOwner: () => false,
        sleep: neverSleep,
        port: 8787,
      }),
    ).rejects.toBe(boom);
  });

  it("does not sleep after the final failed attempt", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    await bindOrDetectRunning({
      startServer: () => Promise.reject(eaddrinuse()),
      readRuntime: () => runtime(),
      probeOurs: () => Promise.resolve(false),
      isLiveOwner: () => false,
      sleep,
      port: 8787,
      maxAttempts: 1,
    });
    expect(sleep).not.toHaveBeenCalled();
  });
});
