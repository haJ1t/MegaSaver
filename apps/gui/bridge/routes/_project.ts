import type { CoreRegistry, Project } from "@megasaver/core";
import { projectIdSchema } from "@megasaver/shared";
import type { RouteContext } from "../route-context.js";
import { zodErrorMessage } from "../zod-schemas.js";

// Resolve a `/api/projects/:id/...` path param to a Project, sending the right
// boundary error (400 validation_failed / 404 project_not_found) and returning
// null when the caller should stop. Shared by every project-scoped read route.
export function resolveProject(ctx: RouteContext, projectIdRaw: string): Project | null {
  const parsed = projectIdSchema.safeParse(projectIdRaw);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      zodErrorMessage(parsed.error),
      ctx.origin,
      parsed.error.issues,
    );
    return null;
  }
  const project = ctx.registry.getProject(parsed.data as Parameters<CoreRegistry["getProject"]>[0]);
  if (!project) {
    ctx.sendError(
      ctx.res,
      404,
      "project_not_found",
      `Project not found: ${parsed.data}`,
      ctx.origin,
    );
    return null;
  }
  return project;
}
