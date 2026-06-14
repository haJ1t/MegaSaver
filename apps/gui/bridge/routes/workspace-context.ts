import { auditPack, buildContextPack } from "@megasaver/context-pruner";
import { readBlocks, resolveWorkspaceIndexPaths } from "@megasaver/indexer";
import type { WorkspaceKey } from "@megasaver/shared";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { intParam } from "./_query.js";

// GET /api/workspaces/:key/context?task=&limit=&maxTokens=&changedFile=&failingTest=
// Read-only context-pack preview over the workspace index blocks. memoryFiles /
// staleFiles stay empty in Phase 3 (cwd-scoped memory is Phase 4). A missing
// index → indexed:false; a corrupt index → index_unavailable.
export function handleGetWorkspaceContext(ctx: RouteContext, key: WorkspaceKey): void {
  const task = ctx.query.get("task");
  if (task === null || task.trim().length === 0) {
    ctx.sendError(ctx.res, 400, "validation_failed", "task is required.", ctx.origin);
    return;
  }
  let blocks: ReturnType<typeof readBlocks>;
  try {
    blocks = readBlocks(resolveWorkspaceIndexPaths(ctx.storeRoot, key));
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
    const limitRaw = ctx.query.get("limit");
    const maxTokensRaw = ctx.query.get("maxTokens");
    const pack = buildContextPack({
      task,
      blocks,
      changedFiles: ctx.query.getAll("changedFile"),
      failingTests: ctx.query.getAll("failingTest"),
      memoryFiles: [],
      staleFiles: [],
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
