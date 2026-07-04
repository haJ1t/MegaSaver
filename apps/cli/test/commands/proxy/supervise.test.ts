import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProxyUsage, startProxyServer } from "@megasaver/llm-proxy";
import type { ProxyUsageEvent, RunningProxy, StartProxyOptions } from "@megasaver/llm-proxy";
import {
  type ProxyRuntimeState,
  type RouteAdapter,
  writeRuntimeState,
} from "@megasaver/proxy-control";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  proxySuperviseCommand,
  runProxySupervise,
  runSupervisor,
} from "../../../src/commands/proxy/supervise.js";

const eaddrinuse = (): NodeJS.ErrnoException => {
  const e = new Error("listen EADDRINUSE: address already in use");
  (e as NodeJS.ErrnoException).code = "EADDRINUSE";
  return e;
};

// A route adapter whose `inspect` is spied so we can assert the monitor never ran.
const spyRoute = (): { route: RouteAdapter; inspect: ReturnType<typeof vi.fn> } => {
  const inspect = vi.fn(() => "absent" as const);
  return {
    inspect,
    route: { inspect, apply: () => {}, removeExpected: () => {} },
  };
};

const EVENT: ProxyUsageEvent = {
  id: "33333333-3333-4333-8333-333333333333",
  ts: "2026-06-24T12:00:00.000Z",
  model: "claude-opus-4-8",
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  messageCount: 3,
  stream: false,
};

describe("runProxySupervise", () => {
  let store: string;
  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), "cli-proxy-"));
  });
  afterEach(() => {
    rmSync(store, { recursive: true, force: true });
  });

  it("starts the server, prints the ANTHROPIC_BASE_URL line, and persists recorded usage", async () => {
    const lines: string[] = [];
    let captured: ((e: ProxyUsageEvent) => void) | undefined;
    const fakeStart = (opts: StartProxyOptions): Promise<RunningProxy> => {
      captured = opts.onUsage;
      return Promise.resolve({
        url: "http://127.0.0.1:8787",
        port: 8787,
        close: () => Promise.resolve(),
      });
    };

    const result = await runProxySupervise({
      port: 8787,
      upstream: "https://api.anthropic.com",
      storeRoot: store,
      stdout: (l) => lines.push(l),
      startServer: fakeStart,
    });

    expect(result.kind).toBe("listening");
    // prints the export line the operator needs
    expect(lines.some((l) => l.includes("export ANTHROPIC_BASE_URL=http://127.0.0.1:8787"))).toBe(
      true,
    );

    // a recorded usage event is persisted to the store
    if (captured === undefined) throw new Error("onUsage was not wired");
    captured(EVENT);
    await new Promise((r) => setTimeout(r, 10)); // let the best-effort persist flush
    const persisted = await listProxyUsage({ storeRoot: store });
    expect(persisted.map((e) => e.id)).toContain(EVENT.id);
  });
});

describe("proxy supervise — credential-forwarding gate", () => {
  let prevExit: typeof process.exitCode;
  beforeEach(() => {
    prevExit = process.exitCode;
    process.exitCode = 0;
  });
  afterEach(() => {
    process.exitCode = prevExit;
  });

  it("refuses a non-default --upstream without --confirm-credential-forwarding", async () => {
    await proxySuperviseCommand.run?.({
      args: { upstream: "https://evil.example.com", "confirm-credential-forwarding": false },
    } as never);
    // Rejected before binding any listener; the operator's key is never forwarded.
    expect(process.exitCode).toBe(1);
  });

  it("refuses a malformed --upstream (userinfo/non-https)", async () => {
    await proxySuperviseCommand.run?.({
      args: { upstream: "https://user:pass@example.com", "confirm-credential-forwarding": true },
    } as never);
    expect(process.exitCode).toBe(1);
  });
});

describe("runSupervisor — idempotent bind", () => {
  let store: string;
  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), "cli-proxy-idem-"));
  });
  afterEach(() => {
    rmSync(store, { recursive: true, force: true });
  });

  // Bind always reports the port taken; the monitor must never run for a no-op.
  const base = () =>
    ({
      port: 8787,
      storeRoot: store,
      upstream: "https://api.anthropic.com",
      ownedUrl: "http://127.0.0.1:8787",
      settingsPath: join(store, "settings.json"),
      stdout: () => {},
      startServer: () => Promise.reject(eaddrinuse()),
      sleep: () => Promise.resolve(),
    }) as const;

  it("returns already-running and never starts the monitor when the holder is ours", async () => {
    const { route, inspect } = spyRoute();
    const result = await runSupervisor({
      ...base(),
      route,
      readRuntime: () =>
        ({ instanceId: "inst-42", healthCapability: "cap" }) as unknown as ProxyRuntimeState,
      probeOurs: () => Promise.resolve(true),
      isLiveOwner: () => false,
    });
    expect(result).toEqual({ kind: "already-running", instanceId: "inst-42" });
    // Monitor never observed reality → no risk of stomping the live owner's route.
    expect(inspect).not.toHaveBeenCalled();
  });

  it("returns foreign (with message) and never starts the monitor for a non-megasaver holder", async () => {
    const { route, inspect } = spyRoute();
    const result = await runSupervisor({
      ...base(),
      route,
      readRuntime: () => null,
      probeOurs: () => Promise.resolve(false),
      isLiveOwner: () => false,
    });
    expect(result.kind).toBe("foreign");
    if (result.kind !== "foreign") throw new Error("expected foreign");
    expect(result.message).toContain("8787");
    expect(result.message).toContain("non-megasaver");
    expect(inspect).not.toHaveBeenCalled();
  });
});

describe("proxy supervise command — idempotent terminal outcomes", () => {
  let store: string;
  let prevExit: typeof process.exitCode;
  let rejections: unknown[];
  const onRejection = (r: unknown) => rejections.push(r);

  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), "cli-proxy-cmd-"));
    prevExit = process.exitCode;
    process.exitCode = 0;
    rejections = [];
    process.on("unhandledRejection", onRejection);
  });
  afterEach(() => {
    process.off("unhandledRejection", onRejection);
    process.exitCode = prevExit;
    rmSync(store, { recursive: true, force: true });
  });

  async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((res) => probe.listen(0, "127.0.0.1", res));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((res) => probe.close(() => res()));
    return port;
  }

  it("exits non-zero with a clear message when a foreign process holds the port (no unhandled rejection)", async () => {
    const port = await freePort();
    // A non-megasaver listener squats the port; there is no runtime.json claiming it.
    const squatter = createServer((_req, res) => res.end());
    await new Promise<void>((res) => squatter.listen(port, "127.0.0.1", res));
    try {
      await proxySuperviseCommand.run?.({ args: { port: String(port), store } } as never);
      expect(process.exitCode).toBe(1);
    } finally {
      await new Promise<void>((res) => squatter.close(() => res()));
    }
    // let any stray microtask settle before asserting no rejection escaped
    await new Promise((r) => setTimeout(r, 20));
    expect(rejections).toEqual([]);
  });

  it("exits 0 without starting a monitor when our own live proxy already owns the port", async () => {
    const port = await freePort();
    const capability = "cap-int-secret";
    const instanceId = "inst-int-1";
    // A REAL megasaver proxy (answers the health probe) already owns the port.
    const held = await startProxyServer({
      port,
      upstreamBaseUrl: "https://api.anthropic.com",
      health: { capability, instanceId },
    });
    // runtime.json advertises the holder so the command's probe can verify it.
    writeRuntimeState(store, {
      version: 1,
      pid: process.pid,
      processStartToken: "tok",
      bootId: "boot",
      instanceId,
      controlUrl: `http://127.0.0.1:${port}`,
      controlToken: "ctl",
      healthCapability: capability,
      proxyUrl: `http://127.0.0.1:${port}`,
      startedAt: "2026-07-03T00:00:00.000Z",
      lastReconciledAt: "2026-07-03T00:00:00.000Z",
      lastUsagePersistedAt: null,
    });
    try {
      await proxySuperviseCommand.run?.({ args: { port: String(port), store } } as never);
      // Idempotent no-op: clean exit 0, the existing proxy keeps the port.
      expect(process.exitCode).toBe(0);
    } finally {
      await held.close();
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(rejections).toEqual([]);
  });
});
