import { clearDiscovery, readDiscovery } from "./discovery.js";
import { clearLock } from "./lock.js";
import { spawnDaemon } from "./spawn.js";

export type DaemonHandle = {
  url: string;
  token: string;
  request: (method: string, path: string, body?: unknown) => Promise<Response>;
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

async function ping(url: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/status`, { headers: { authorization: `Bearer ${token}` } });
    return res.ok;
  } catch {
    return false;
  }
}

function makeHandle(url: string, token: string): DaemonHandle {
  return {
    url,
    token,
    request: (method, path, body) =>
      fetch(`${url}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getDaemon(opts: GetDaemonOptions): Promise<DaemonHandle> {
  const { storeRoot } = opts;
  const spawn = opts.spawn ?? spawnDaemon;

  const existing = readDiscovery(storeRoot);
  if (existing && (await ping(urlFor(existing.port), existing.token))) {
    return makeHandle(urlFor(existing.port), existing.token);
  }
  // Stale advertisement (or none): reap before spawning so the new daemon's
  // exclusive lock + discovery write win cleanly.
  if (existing) {
    clearDiscovery(storeRoot);
    clearLock(storeRoot);
  }

  spawn(storeRoot);

  const deadline = Date.now() + (opts.waitMs ?? 5000);
  while (Date.now() < deadline) {
    const disc = readDiscovery(storeRoot);
    if (disc && (await ping(urlFor(disc.port), disc.token))) {
      return makeHandle(urlFor(disc.port), disc.token);
    }
    await sleep(100);
  }
  throw new Error("daemon did not come up in time");
}
