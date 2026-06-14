import { readOverlayTaskPlans, readySteps } from "@megasaver/core";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { resolveSessionWorkspace, sendSessionResolveError } from "./_claude-session.js";

// GET /api/claude-sessions/:dir/:id/tasks — read-only overlay task-plan list for
// the resolved (workspaceKey, liveSessionId), merged with the workspace-level
// (null liveSessionId) plans. Each plan ships with its ready steps.
export async function handleGetSessionTasks(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const resolved = await resolveSessionWorkspace(ctx, dir, id);
  if (resolved === "unsafe" || resolved === "not_found") {
    sendSessionResolveError(ctx, resolved, dir, id);
    return;
  }
  try {
    const sessionPlans = readOverlayTaskPlans(
      ctx.storeRoot,
      resolved.workspaceKey,
      resolved.liveSessionId,
    );
    const workspacePlans = readOverlayTaskPlans(ctx.storeRoot, resolved.workspaceKey, null);
    const body = [...sessionPlans, ...workspacePlans]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((plan) => ({ plan, ready: readySteps(plan.steps) }));
    ctx.sendJson(ctx.res, 200, body, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
