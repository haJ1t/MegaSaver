import { getRunningDaemon } from "@megasaver/daemon";
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
