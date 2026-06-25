import { getRunningDaemon } from "@megasaver/daemon";

/**
 * Try to forward a request to the running daemon; fall back to inProcess() on
 * any error (daemon down, non-2xx, network throw, getRunningDaemon throw).
 *
 * Uses getRunningDaemon (NO-SPAWN): returns null immediately when no daemon is
 * reachable — zero spawn latency on the hot MCP tool path.
 *
 * ponytail: no handle caching — one ping per tool call (loopback, 1.5s-bounded).
 * Cache when profiling shows it matters.
 */
export async function forwardOrFallback<T>(
  storeRoot: string,
  routePath: string,
  body: unknown,
  inProcess: () => Promise<T>,
  mapResponse: (json: unknown) => T = (j) => j as T,
): Promise<T> {
  try {
    const handle = await getRunningDaemon({ storeRoot });
    if (handle === null) return inProcess();

    const res = await handle.request("POST", routePath, body);
    if (!res.ok) return inProcess();

    return mapResponse(await res.json());
  } catch {
    return inProcess();
  }
}
