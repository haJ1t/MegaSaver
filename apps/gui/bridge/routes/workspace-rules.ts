import { rankApplicableRules, readWorkspaceRules } from "@megasaver/core";
import type { WorkspaceKey } from "@megasaver/shared";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";

// GET /api/workspaces/:key/rules?task=&files=&files=
// Read-only: lists workspace-overlay rules ranked for an optional task/files
// filter. An empty overlay reads as [] (no overlay file → empty).
export function handleGetWorkspaceRules(ctx: RouteContext, key: WorkspaceKey): void {
  try {
    const rules = readWorkspaceRules(ctx.storeRoot, key);
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
