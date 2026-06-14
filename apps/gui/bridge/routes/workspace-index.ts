import {
  readBlocks,
  readManifest,
  resolveWorkspaceIndexPaths,
  searchBlocks,
} from "@megasaver/indexer";
import type { WorkspaceKey } from "@megasaver/shared";
import type { RouteContext } from "../route-context.js";
import { intParam } from "./_query.js";

type IndexStatusResponse = {
  indexed: boolean;
  total: number;
  indexedFiles: number;
  byType: Record<string, number>;
};

// GET /api/workspaces/:key/index — block totals by type, keyed by workspaceKey.
// Missing index → indexed:false (build CTA); corrupt index → index_unavailable.
export function handleGetWorkspaceIndexStatus(ctx: RouteContext, key: WorkspaceKey): void {
  try {
    const paths = resolveWorkspaceIndexPaths(ctx.storeRoot, key);
    const blocks = readBlocks(paths);
    const indexedFiles = Object.keys(readManifest(paths).files).length;
    const byType: Record<string, number> = {};
    for (const block of blocks) {
      byType[block.blockType] = (byType[block.blockType] ?? 0) + 1;
    }
    const body: IndexStatusResponse = {
      indexed: blocks.length > 0,
      total: blocks.length,
      indexedFiles,
      byType,
    };
    ctx.sendJson(ctx.res, 200, body, ctx.origin);
  } catch (err) {
    ctx.sendError(
      ctx.res,
      500,
      "index_unavailable",
      err instanceof Error ? err.message : String(err),
      ctx.origin,
    );
  }
}

// GET /api/workspaces/:key/index/search?q=&type=&limit=&offset=
export function handleGetWorkspaceIndexSearch(ctx: RouteContext, key: WorkspaceKey): void {
  const q = ctx.query.get("q") ?? ctx.query.get("query");
  if (q === null || q.trim().length === 0) {
    ctx.sendError(ctx.res, 400, "validation_failed", "query (q) is required.", ctx.origin);
    return;
  }
  try {
    const paths = resolveWorkspaceIndexPaths(ctx.storeRoot, key);
    const blocks = readBlocks(paths);
    const typeRaw = ctx.query.get("type");
    const hits = searchBlocks(blocks, {
      text: q.trim(),
      ...(typeRaw !== null && typeRaw.length > 0
        ? { type: typeRaw as NonNullable<Parameters<typeof searchBlocks>[1]["type"]> }
        : {}),
    });
    const offset = intParam(ctx.query.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(ctx.query.get("limit"), 50, 1, 200);
    ctx.sendJson(ctx.res, 200, hits.slice(offset, offset + limit), ctx.origin);
  } catch (err) {
    ctx.sendError(
      ctx.res,
      500,
      "index_unavailable",
      err instanceof Error ? err.message : String(err),
      ctx.origin,
    );
  }
}
