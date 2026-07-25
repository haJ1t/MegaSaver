import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDaemon, getRunningDaemon } from "../src/client.js";
import { writeDiscovery } from "../src/discovery.js";
import { acquireLock } from "../src/lock.js";
import { type RunningDaemon, startDaemonServer } from "../src/server.js";

let store: string;
let servers: RunningDaemon[];
let impostors: Impostor[];
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "daemon-cli-"));
  servers = [];
  impostors = [];
});
afterEach(async () => {
  for (const s of servers) await s.close();
  for (const i of impostors) await i.close();
  rmSync(store, { recursive: true, force: true });
});

// A real process that has really exited: its pid can never be our daemon.
async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve) => child.once("exit", resolve));
  return child.pid as number;
}

type Impostor = { port: number; auth: string[]; close: () => Promise<void> };

// Stands in for whatever local process grabs the freed ephemeral port after a
// SIGKILLed daemon: answers 200 to everything and records the tokens it is sent.
async function startImpostor(): Promise<Impostor> {
  const auth: string[] = [];
  const server = createServer((req, res) => {
    auth.push(String(req.headers.authorization));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ text: "impostor payload" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const impostor: Impostor = {
    port: (server.address() as AddressInfo).port,
    auth,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  impostors.push(impostor);
  return impostor;
}

// Injected "spawn" starts an in-process daemon instead of a subprocess.
const inProcessSpawn = (root: string) => {
  void startDaemonServer({ storeRoot: root, port: 0 }).then((s) => servers.push(s));
};

describe("getDaemon", () => {
  it("connects to an already-running daemon without spawning", async () => {
    const running = await startDaemonServer({ storeRoot: store, port: 0, token: "live" });
    servers.push(running);
    let spawned = false;
    const handle = await getDaemon({
      storeRoot: store,
      spawn: () => {
        spawned = true;
      },
    });
    expect(spawned).toBe(false);
    const res = await handle.request("GET", "/status");
    expect(res.status).toBe(200);
  });

  it("spawns a daemon when none is running, then connects", async () => {
    const handle = await getDaemon({ storeRoot: store, spawn: inProcessSpawn, waitMs: 3000 });
    const res = await handle.request("GET", "/status");
    expect(res.status).toBe(200);
  });

  it("reaps stale discovery (points at a dead port) before spawning", async () => {
    writeDiscovery(store, { port: 1, token: "dead", pid: 1, startedAt: "x" });
    const handle = await getDaemon({ storeRoot: store, spawn: inProcessSpawn, waitMs: 3000 });
    expect((await handle.request("GET", "/status")).status).toBe(200);
  });

  it("reaps a leftover lock with no discovery (post-/shutdown state) before spawning", async () => {
    // Post-/shutdown: discovery cleared by server.close(), lock left behind.
    expect(acquireLock(store)).not.toBeNull();
    // Spawn that models `mega daemon serve`: it only starts if it wins the lock,
    // so a surviving lock wedges it unless getDaemon reaps the lock first.
    const lockAwareSpawn = (root: string) => {
      if (acquireLock(root) === null) return;
      void startDaemonServer({ storeRoot: root, port: 0 }).then((s) => servers.push(s));
    };
    const handle = await getDaemon({ storeRoot: store, spawn: lockAwareSpawn, waitMs: 3000 });
    expect((await handle.request("GET", "/status")).status).toBe(200);
  });

  it("throws if the daemon never comes up", async () => {
    await expect(getDaemon({ storeRoot: store, spawn: () => {}, waitMs: 300 })).rejects.toThrow(
      /did not come up/,
    );
  });
});

describe("getRunningDaemon", () => {
  it("returns a handle when a daemon is already running", async () => {
    const running = await startDaemonServer({ storeRoot: store, port: 0, token: "live" });
    servers.push(running);
    const handle = await getRunningDaemon({ storeRoot: store });
    expect(handle).not.toBeNull();
    const res = await handle?.request("GET", "/status");
    expect(res?.status).toBe(200);
  });

  it("returns null when no discovery file exists", async () => {
    const handle = await getRunningDaemon({ storeRoot: store });
    expect(handle).toBeNull();
  });

  it("returns null when discovery points at a dead port (ping fails)", async () => {
    writeDiscovery(store, { port: 1, token: "dead", pid: 1, startedAt: "x" });
    const handle = await getRunningDaemon({ storeRoot: store });
    expect(handle).toBeNull();
  });

  it("returns null when the recorded pid is gone, even if the port answers", async () => {
    const impostor = await startImpostor();
    writeDiscovery(store, {
      port: impostor.port,
      token: "stale-token",
      pid: await exitedPid(),
      startedAt: new Date().toISOString(),
    });
    const handle = await getRunningDaemon({ storeRoot: store });
    expect(handle).toBeNull();
    expect(impostor.auth).toEqual([]);
  });
});

describe("stale discovery with a live squatter on the port", () => {
  it("getDaemon ignores it and spawns a real daemon", async () => {
    const impostor = await startImpostor();
    writeDiscovery(store, {
      port: impostor.port,
      token: "stale-token",
      pid: await exitedPid(),
      startedAt: new Date().toISOString(),
    });
    const handle = await getDaemon({ storeRoot: store, spawn: inProcessSpawn, waitMs: 3000 });
    expect(handle.url).not.toContain(`:${impostor.port}`);
    expect((await handle.request("GET", "/status")).status).toBe(200);
    expect(impostor.auth).toEqual([]);
  });
});
