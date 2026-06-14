import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { resolveProject } from "./_project.js";

// GET /api/projects/:id/tools?task= — read-only tool-router preview. Returns the
// allowed/blocked split + reason for an optional task, plus the full registered
// tool list so the view can show an empty-state when none are registered.
export function handleGetTools(ctx: RouteContext, projectIdRaw: string): void {
  const project = resolveProject(ctx, projectIdRaw);
  if (!project) return;
  try {
    const taskRaw = ctx.query.get("task");
    const task = taskRaw !== null && taskRaw.trim().length > 0 ? taskRaw : undefined;
    const route = ctx.registry.routeToolsForTask(project.id, task);
    const tools = ctx.registry.listToolDefinitions(project.id);
    ctx.sendJson(ctx.res, 200, { route, tools }, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
