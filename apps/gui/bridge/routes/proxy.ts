import { proxyStatus, startProxy, stopProxy } from "../proxy-control.js";
import type { RouteContext } from "../route-context.js";
import { readJsonBody } from "./_body.js";

export async function handleProxyStatus(ctx: RouteContext): Promise<void> {
  ctx.sendJson(ctx.res, 200, proxyStatus(), ctx.origin);
}

export async function handleProxySet(ctx: RouteContext): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const enabled = (body as { enabled?: unknown })?.enabled;
  if (typeof enabled !== "boolean") {
    ctx.sendError(ctx.res, 400, "validation_failed", "Expected { enabled: boolean }.", ctx.origin);
    return;
  }
  const status = enabled ? await startProxy(ctx.storeRoot) : await stopProxy();
  ctx.sendJson(ctx.res, 200, status, ctx.origin);
}
