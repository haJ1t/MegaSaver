import type { RouteContext } from "../route-context.js";
import { readJsonBody } from "./_body.js";

export async function handlePostHandoffPack(ctx: RouteContext): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const payload = body as { workspaceKey?: string; targetAgent?: string; dryRun?: boolean };
  const targetAgent = payload.targetAgent ?? "cursor";

  ctx.sendJson(
    ctx.res,
    200,
    {
      targetAgent,
      packed: true,
      findingsCount: 0,
      brief: "Hot handoff packet ready for transfer.",
    },
    ctx.origin,
  );
}

export async function handleDeleteHandoffClear(ctx: RouteContext): Promise<void> {
  const targetAgent = ctx.query.get("targetAgent") ?? "cursor";
  ctx.sendJson(
    ctx.res,
    200,
    {
      cleared: true,
      targetAgent,
    },
    ctx.origin,
  );
}
