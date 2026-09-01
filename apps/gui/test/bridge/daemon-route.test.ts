// @vitest-environment node
// Node env required: getRunningDaemon uses AbortSignal.timeout inside Node fetch;
// jsdom's fetch rejects Node-native AbortSignal instances (class mismatch).
import { acquireLock, startDaemonServer, writeDiscovery } from "@megasaver/daemon";
import type { RunningDaemon } from "@megasaver/daemon";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, startTestBridge } from "./test-helpers.js";

let server: TestServer;
let daemon: RunningDaemon | null = null;

beforeEach(async () => {
  server = await startTestBridge();
});

afterEach(async () => {
  if (daemon) {
    await daemon.close();
    daemon = null;
  }
  await server.close();
});

describe("GET /api/daemon", () => {
  it("returns {running:false} when no daemon is advertised", async () => {
    const res = await fetch(`${server.baseUrl}/api/daemon`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ running: false });
  });

  it("returns {running:true, url, sessions:0} when a daemon is live", async () => {
    daemon = await startDaemonServer({ storeRoot: server.storePath, port: 0 });
    const res = await fetch(`${server.baseUrl}/api/daemon`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.running).toBe(true);
    expect(body.url).toBe(daemon.url);
    expect(body.sessions).toBe(0);
  });

  it("returns 405 for POST /api/daemon", async () => {
    const res = await fetch(`${server.baseUrl}/api/daemon`, { method: "POST" });
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.code).toBe("method_not_allowed");
  });
});

describe("POST /api/daemon/start — supervisor auto-recover", () => {
  it("recovers from stale discovery (dead pid) + leftover lock and reports running:true", async () => {
    // Leave a stale discovery (port 1 / pid 1 can never be alive) and a stale lock
    // behind to simulate a SIGKILLed daemon. Without crash-recovery the spawn
    // wedges on its own stale lock and the test would hit 500 / {starting:true}.
    writeDiscovery(server.storePath, {
      port: 1,
      token: "dead-token",
      pid: 1,
      startedAt: "1970-01-01T00:00:00.000Z",
    });
    const staleLock = acquireLock(server.storePath);
    expect(staleLock).not.toBeNull();

    // In-process spawn hook so the test never forks a real subprocess.
    const localDaemons: RunningDaemon[] = [];
    const inProcessSpawn = (root: string): void => {
      void startDaemonServer({ storeRoot: root, port: 0 }).then((d) => localDaemons.push(d));
    };

    // Recreate bridge with the spawn hook (storePath stays same, so stale state is visible).
    await server.close();
    server = await startTestBridge({ daemonSpawn: inProcessSpawn });
    // Must re-seed the stale state after startTestBridge made a fresh tmp dir — use server.storePath directly.
    writeDiscovery(server.storePath, {
      port: 1,
      token: "dead-token",
      pid: 1,
      startedAt: "1970-01-01T00:00:00.000Z",
    });
    const lock2 = acquireLock(server.storePath);
    expect(lock2).not.toBeNull();

    const res = await fetch(`${server.baseUrl}/api/daemon/start`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      running: boolean;
      url?: string;
      starting?: boolean;
    };
    expect(body.running).toBe(true);
    expect(typeof body.url).toBe("string");
    expect((body.url as string).startsWith("http://127.0.0.1:")).toBe(true);
    expect(body.starting).toBeUndefined();

    // Second call should be idempotent — already running.
    const res2 = await fetch(`${server.baseUrl}/api/daemon/start`, { method: "POST" });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { running: boolean; url?: string };
    expect(body2.running).toBe(true);

    for (const d of localDaemons) await d.close();
  });

  it("full lifecycle: GET stopped → POST start → GET running → POST stop → GET stopped", async () => {
    const localDaemons: RunningDaemon[] = [];
    const inProcessSpawn = (root: string): void => {
      void startDaemonServer({ storeRoot: root, port: 0 }).then((d) => localDaemons.push(d));
    };
    await server.close();
    server = await startTestBridge({ daemonSpawn: inProcessSpawn });

    let r = await fetch(`${server.baseUrl}/api/daemon`);
    expect((await r.json()).running).toBe(false);

    r = await fetch(`${server.baseUrl}/api/daemon/start`, { method: "POST" });
    expect(r.status).toBe(200);
    expect((await r.json()).running).toBe(true);

    r = await fetch(`${server.baseUrl}/api/daemon`);
    const live = (await r.json()) as { running: boolean; url: string };
    expect(live.running).toBe(true);

    r = await fetch(`${server.baseUrl}/api/daemon/stop`, { method: "POST" });
    expect(r.status).toBe(200);
    const stopped = (await r.json()) as { ok: boolean; running?: boolean; stopped?: boolean };
    expect(stopped.ok).toBe(true);

    r = await fetch(`${server.baseUrl}/api/daemon`);
    expect((await r.json()).running).toBe(false);

    for (const d of localDaemons) await d.close();
  });

  it("POST /api/daemon/stop is idempotent when no daemon is running", async () => {
    const res = await fetch(`${server.baseUrl}/api/daemon/stop`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; running: boolean };
    expect(body.ok).toBe(true);
    expect(body.running).toBe(false);
  });
});
