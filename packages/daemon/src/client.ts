import { type Discovery, clearDiscovery, readDiscovery } from "./discovery.js";
import { clearLock } from "./lock.js";
import { spawnDaemon } from "./spawn.js";

export type DaemonHandle = {
  url: string;
  token: string;
  request: (
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ) => Promise<Response>;
};

export type GetDaemonOptions = {
  storeRoot: string;
  /** Injectable for tests; defaults to a detached `mega daemon serve`. */
  spawn?: (storeRoot: string) => void;
  /** Total time to wait for a spawned daemon to advertise itself. */
  waitMs?: number;
};

function urlFor(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = the process is gone. EPERM = it exists but isn't ours to signal;
    // treat that as alive so a permission quirk can't wedge a live daemon.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

// A SIGKILLed daemon leaves discovery behind (only close() clears it) and frees
// its ephemeral port. Without the pid check we hand the stale bearer token to
// whatever local process grabbed that port, then trust its JSON as tool output.
async function ping(disc: Discovery): Promise<boolean> {
  if (!pidAlive(disc.pid)) return false;
  try {
    const res = await fetch(`${urlFor(disc.port)}/status`, {
      headers: { authorization: `Bearer ${disc.token}` },
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function makeHandle(url: string, token: string): DaemonHandle {
  return {
    url,
    token,
    request: (method, path, body, signal) =>
      fetch(`${url}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal !== undefined ? { signal } : {}),
      }),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns a handle to an already-running daemon, or null if none is reachable.
 *  Never spawns, never waits, never mutates lock/discovery. */
export async function getRunningDaemon(opts: { storeRoot: string }): Promise<DaemonHandle | null> {
  const disc = readDiscovery(opts.storeRoot);
  if (disc === null) return null;
  if (!(await ping(disc))) return null;
  return makeHandle(urlFor(disc.port), disc.token);
}

export async function getDaemon(opts: GetDaemonOptions): Promise<DaemonHandle> {
  const { storeRoot } = opts;
  const spawn = opts.spawn ?? spawnDaemon;

  const existing = readDiscovery(storeRoot);
  if (existing && (await ping(existing))) {
    return makeHandle(urlFor(existing.port), existing.token);
  }
  // A leftover lock with no live discovery is exactly the post-/shutdown state,
  // so reap both unconditionally before spawning — the live-daemon case already
  // returned above.
  clearDiscovery(storeRoot);
  clearLock(storeRoot);

  spawn(storeRoot);

  const deadline = Date.now() + (opts.waitMs ?? 5000);
  while (Date.now() < deadline) {
    const disc = readDiscovery(storeRoot);
    if (disc && (await ping(disc))) {
      return makeHandle(urlFor(disc.port), disc.token);
    }
    await sleep(100);
  }
  throw new Error("daemon did not come up in time");
}
