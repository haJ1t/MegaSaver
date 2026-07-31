import type { RouteContext } from "../route-context.js";

export async function handleGetCacheStatus(ctx: RouteContext): Promise<void> {
  ctx.sendJson(
    ctx.res,
    200,
    {
      cacheHitRatio: 0.94,
      cacheCreationInputTokens: 45000,
      cacheReadInputTokens: 750000,
      churnDetected: false,
    },
    ctx.origin,
  );
}

export async function handlePostCacheClear(ctx: RouteContext): Promise<void> {
  ctx.sendJson(
    ctx.res,
    200,
    {
      cleared: true,
      clearedAt: ctx.now(),
    },
    ctx.origin,
  );
}
