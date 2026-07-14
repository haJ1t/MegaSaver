import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProxyUsage } from "@megasaver/llm-proxy";
import type { ProxyUsageEvent, RunningProxy, StartProxyOptions } from "@megasaver/llm-proxy";
import type { RouteAdapter } from "@megasaver/proxy-control";
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
    route: { inspect, apply: () => false, removeExpected: () => {} },
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

  const base = () =>
    ({
      port: 8787,
      storeRoot: store,
      upstream: "https://api.anthropic.com",
      ownedUrl: "http://127.0.0.1:8787",
      settingsPath: join(store, "settings.json"),
      stdout: () => {},
      sleep: () => Promise.resolve(),
    }) as const;

  it("returns already-in-use and never starts the monitor when EADDRINUSE persists", async () => {
    const { route, inspect } = spyRoute();
    const result = await runSupervisor({
      ...base(),
      route,
      startServer: () => Promise.reject(eaddrinuse()),
    });
    expect(result).toEqual({ kind: "already-in-use" });
    // Monitor never observed reality → no risk of stomping the live owner's route.
    expect(inspect).not.toHaveBeenCalled();
  });

  it("rethrows a non-EADDRINUSE bind error (never swallowed as already-in-use)", async () => {
    const boom = new Error("EACCES: permission denied");
    (boom as NodeJS.ErrnoException).code = "EACCES";
    const { route } = spyRoute();
    await expect(
      runSupervisor({ ...base(), route, startServer: () => Promise.reject(boom) }),
    ).rejects.toBe(boom);
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

  it("exits 0 with a clear message and no monitor when the port is already in use (no unhandled rejection)", async () => {
    const port = await freePort();
    const errs: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...a) => errs.push(a.join(" ")));
    // A process already owns the port; the bind persistently sees EADDRINUSE.
    const squatter = createServer((_req, res) => res.end());
    await new Promise<void>((res) => squatter.listen(port, "127.0.0.1", res));
    try {
      await proxySuperviseCommand.run?.({ args: { port: String(port), store } } as never);
      // Idempotent no-op on a KeepAlive singleton: clean exit 0 so launchd does not
      // treat it as a crash and respawn.
      expect(process.exitCode).toBe(0);
      expect(errs.some((l) => l.includes(String(port)))).toBe(true);
    } finally {
      errSpy.mockRestore();
      await new Promise<void>((res) => squatter.close(() => res()));
    }
    // let any stray microtask settle before asserting no rejection escaped
    await new Promise((r) => setTimeout(r, 20));
    expect(rejections).toEqual([]);
  });
});
