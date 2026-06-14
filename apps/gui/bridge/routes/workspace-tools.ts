import { readWorkspaceTools, routeToolsForTask } from "@megasaver/core";
import type { WorkspaceKey } from "@megasaver/shared";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";

// GET /api/workspaces/:key/tools?task= — read-only tool-router preview over the
// workspace overlay. Returns the allowed/blocked split + reason for an optional
// task, plus the full tool list. An empty overlay → { route, tools: [] }.
export function handleGetWorkspaceTools(ctx: RouteContext, key: WorkspaceKey): void {
  try {
    const tools = readWorkspaceTools(ctx.storeRoot, key);
    const taskRaw = ctx.query.get("task");
    const task = taskRaw !== null && taskRaw.trim().length > 0 ? taskRaw : undefined;
    const route = routeToolsForTask(tools, task);
    ctx.sendJson(ctx.res, 200, { route, tools }, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
