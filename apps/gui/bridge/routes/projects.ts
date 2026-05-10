import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";

export function handleGetProjects(ctx: RouteContext): void {
  try {
    const projects = ctx.registry
      .listProjects()
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    ctx.sendJson(ctx.res, 200, projects, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
