import { rankApplicableRules } from "@megasaver/core";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { resolveProject } from "./_project.js";

// GET /api/projects/:id/rules?task=&files=&files=
// Read-only FORGE surface: lists rules ranked for an optional task/files filter.
// With no filter, returns every rule (score 0, reason "no task filter").
export function handleGetRules(ctx: RouteContext, projectIdRaw: string): void {
  const project = resolveProject(ctx, projectIdRaw);
  if (!project) return;
  try {
    const rules = ctx.registry.listProjectRules(project.id);
    const taskRaw = ctx.query.get("task");
    const files = ctx.query.getAll("files");
    const ranked = rankApplicableRules(rules, {
      ...(taskRaw !== null && taskRaw.trim().length > 0 ? { task: taskRaw } : {}),
      files,
    });
    ctx.sendJson(ctx.res, 200, ranked, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
