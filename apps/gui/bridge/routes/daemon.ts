import { clearDiscovery, clearLock, getRunningDaemon, spawnDaemon } from "@megasaver/daemon";
import { readDiscovery } from "@megasaver/daemon";
import type { RouteContext } from "../route-context.js";

export async function handleDaemonStatus(ctx: RouteContext): Promise<void> {
  try {
    const handle = await getRunningDaemon({ storeRoot: ctx.storeRoot });
    if (handle === null) {
      ctx.sendJson(ctx.res, 200, { running: false }, ctx.origin);
      return;
    }
    try {
      const statusRes = await handle.request("GET", "/status");
      if (!statusRes.ok) {
        ctx.sendJson(ctx.res, 200, { running: false }, ctx.origin);
        return;
      }
      const body = (await statusRes.json()) as { sessions?: unknown; totals?: unknown };
      const sessions = Array.isArray(body.sessions) ? body.sessions.length : 0;
      ctx.sendJson(ctx.res, 200, { running: true, url: handle.url, sessions }, ctx.origin);
    } catch {
      ctx.sendJson(ctx.res, 200, { running: false }, ctx.origin);
    }
  } catch {
    // ponytail: daemon-down is the normal case; never let this throw
    ctx.sendJson(ctx.res, 200, { running: false }, ctx.origin);
  }
}

export async function handleDaemonStart(ctx: RouteContext): Promise<void> {
  try {
    const existing = await getRunningDaemon({ storeRoot: ctx.storeRoot });
    if (existing !== null) {
      ctx.sendJson(ctx.res, 200, { ok: true, running: true, url: existing.url }, ctx.origin);
      return;
    }
    // Mirror getDaemon's crash-recovery: stale discovery (dead pid/closed port)
    // and leftover lock from a SIGKILLed daemon must be reaped before spawning,
    // otherwise the spawn is wedge-guarded by its own stale lock.
    clearDiscovery(ctx.storeRoot);
    clearLock(ctx.storeRoot);
    const doSpawn = ctx.daemonSpawn ?? spawnDaemon;
    doSpawn(ctx.storeRoot);
    // Poll up to ~5s for discovery+ping to become live. This turns the
    // fire-and-forget into a visible success for the GUI poll (which was
    // stuck on Daemon stopped forever with {starting:true}).
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 80));
      const disc = readDiscovery(ctx.storeRoot);
      if (disc !== null) {
        const handle = await getRunningDaemon({ storeRoot: ctx.storeRoot });
        if (handle !== null) {
          ctx.sendJson(ctx.res, 200, { ok: true, running: true, url: handle.url }, ctx.origin);
          return;
        }
      }
    }
    ctx.sendError(ctx.res, 500, "internal_error", "daemon did not come up in time", ctx.origin);
  } catch (err) {
    ctx.sendError(ctx.res, 500, "internal_error", String(err), ctx.origin);
  }
}

export async function handleDaemonStop(ctx: RouteContext): Promise<void> {
  try {
    const handle = await getRunningDaemon({ storeRoot: ctx.storeRoot });
    if (handle === null) {
      ctx.sendJson(ctx.res, 200, { ok: true, running: false }, ctx.origin);
      return;
    }
    try {
      await handle.request("POST", "/shutdown");
    } catch {}
    ctx.sendJson(ctx.res, 200, { ok: true, stopped: true }, ctx.origin);
  } catch (err) {
    ctx.sendError(ctx.res, 500, "internal_error", String(err), ctx.origin);
  }
}
