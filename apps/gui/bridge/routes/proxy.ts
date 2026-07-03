import { proxyStatus, startProxy, stopProxy } from "../proxy-control.js";
import type { RouteContext } from "../route-context.js";
import { readJsonBody } from "./_body.js";

export async function handleProxyStatus(ctx: RouteContext): Promise<void> {
  ctx.sendJson(ctx.res, 200, proxyStatus(ctx.storeRoot), ctx.origin);
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
  // The persistent supervisor owns routing; the toggle only persists desired
  // state. The operator restarts Claude manually when convenient (no osascript).
  // `confirmClientsRestarted` on an off-toggle finishes the drain (stops the
  // supervisor's key-holding listener) once no live client points at the proxy.
  const confirmClientsRestarted =
    (body as { confirmClientsRestarted?: unknown })?.confirmClientsRestarted === true;
  const status = enabled
    ? startProxy(ctx.storeRoot)
    : stopProxy(ctx.storeRoot, undefined, { confirmClientsRestarted });
  ctx.sendJson(ctx.res, 200, status, ctx.origin);
}
