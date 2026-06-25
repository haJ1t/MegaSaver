import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDaemon } from "../src/client.js";
import { writeDiscovery } from "../src/discovery.js";
import { acquireLock } from "../src/lock.js";
import { type RunningDaemon, startDaemonServer } from "../src/server.js";

let store: string;
let servers: RunningDaemon[];
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "daemon-cli-"));
  servers = [];
});
afterEach(async () => {
  for (const s of servers) await s.close();
  rmSync(store, { recursive: true, force: true });
});

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
