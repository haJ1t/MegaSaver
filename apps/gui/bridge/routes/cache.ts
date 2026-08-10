import type { RouteContext } from "../route-context.js";
import { analyzeCacheChurn } from "@megasaver/stats";
import type { TokenSaverEvent } from "@megasaver/stats";

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

export async function handleGetCacheChurn(ctx: RouteContext & { readEvents?: (storeRoot: string) => TokenSaverEvent[] }): Promise<void> {
  const reader = ctx.readEvents ?? (() => [] as TokenSaverEvent[]);
  let events: TokenSaverEvent[] = [];
  try { events = reader(ctx.storeRoot); } catch { events = []; }
  const result = analyzeCacheChurn(events);
  ctx.sendJson(ctx.res, 200, result, ctx.origin);
}
