import type { RouteContext } from "../route-context.js";

export function handleGetHealth(ctx: RouteContext, storePath: string): void {
  ctx.sendJson(ctx.res, 200, { ok: true, store: storePath }, ctx.origin);
}
