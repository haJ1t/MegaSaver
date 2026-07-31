import type { RouteContext } from "../route-context.js";

export async function handleGetBrainSyncStatus(ctx: RouteContext): Promise<void> {
  ctx.sendJson(
    ctx.res,
    200,
    {
      configured: false,
      status: "idle",
      lastSyncedAt: null,
    },
    ctx.origin,
  );
}

export async function handlePostBrainSyncTrigger(ctx: RouteContext): Promise<void> {
  ctx.sendJson(
    ctx.res,
    200,
    {
      status: "success",
      syncedAt: ctx.now(),
    },
    ctx.origin,
  );
}
