import { readySteps } from "@megasaver/core";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { resolveProject } from "./_project.js";

// GET /api/projects/:id/tasks — read-only task-plan list. Each plan ships with
// its full step list plus the ids of the steps that are currently ready (no
// blocking dependency), so the view can render status without a second call.
export function handleGetTasks(ctx: RouteContext, projectIdRaw: string): void {
  const project = resolveProject(ctx, projectIdRaw);
  if (!project) return;
  try {
    const plans = ctx.registry
      .listTaskPlans(project.id)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const body = plans.map((plan) => ({ plan, ready: readySteps(plan.steps) }));
    ctx.sendJson(ctx.res, 200, body, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
