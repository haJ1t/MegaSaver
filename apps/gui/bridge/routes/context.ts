import { auditPack, buildContextPack } from "@megasaver/context-pruner";
import { readBlocks, resolveIndexPaths } from "@megasaver/indexer";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { resolveProject } from "./_project.js";
import { intParam } from "./_query.js";

// GET /api/projects/:id/context?task=&limit=&maxTokens=&changedFile=&failingTest=
// Read-only context-pack preview: builds the pack from the existing index +
// task-relevant memories and reports the token-savings audit. Compute-heavy but
// bounded (§6) — no build/write, no job model. A missing index → indexed:false
// so the GUI shows a build CTA; a corrupt index → index_unavailable.
export function handleGetContext(ctx: RouteContext, projectIdRaw: string): void {
  const project = resolveProject(ctx, projectIdRaw);
  if (!project) return;
  const task = ctx.query.get("task");
  if (task === null || task.trim().length === 0) {
    ctx.sendError(ctx.res, 400, "validation_failed", "task is required.", ctx.origin);
    return;
  }
  let blocks: ReturnType<typeof readBlocks>;
  try {
    blocks = readBlocks(resolveIndexPaths(ctx.storeRoot, project.id));
  } catch (err) {
    ctx.sendError(
      ctx.res,
      500,
      "index_unavailable",
      err instanceof Error ? err.message : String(err),
      ctx.origin,
    );
    return;
  }
  try {
    const memories = ctx.registry.searchMemoryEntries(project.id, { text: task });
    const memoryFiles = memories.filter((m) => !m.stale).flatMap((m) => m.relatedFiles ?? []);
    const staleFiles = memories.filter((m) => m.stale).flatMap((m) => m.relatedFiles ?? []);
    const limitRaw = ctx.query.get("limit");
    const maxTokensRaw = ctx.query.get("maxTokens");
    const pack = buildContextPack({
      task,
      blocks,
      changedFiles: ctx.query.getAll("changedFile"),
      failingTests: ctx.query.getAll("failingTest"),
      memoryFiles,
      staleFiles,
      ...(limitRaw !== null ? { limit: intParam(limitRaw, 8, 1, 100) } : {}),
      ...(maxTokensRaw !== null
        ? { maxTokens: intParam(maxTokensRaw, 0, 1, Number.MAX_SAFE_INTEGER) }
        : {}),
    });
    ctx.sendJson(
      ctx.res,
      200,
      { indexed: blocks.length > 0, pack, audit: auditPack(pack) },
      ctx.origin,
    );
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
