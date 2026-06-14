import { readBlocks, readManifest, resolveIndexPaths, searchBlocks } from "@megasaver/indexer";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { resolveProject } from "./_project.js";
import { intParam } from "./_query.js";

export type IndexStatusResponse = {
  indexed: boolean;
  total: number;
  indexedFiles: number;
  byType: Record<string, number>;
};

// GET /api/projects/:id/index — block totals by type. A missing index reads as
// empty (indexed:false) so the GUI can show a build CTA; a corrupt index throws
// and surfaces as index_unavailable (§3d — corruption must be visible, never a
// silent empty).
export function handleGetIndexStatus(ctx: RouteContext, projectIdRaw: string): void {
  const project = resolveProject(ctx, projectIdRaw);
  if (!project) return;
  try {
    const paths = resolveIndexPaths(ctx.storeRoot, project.id);
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

// GET /api/projects/:id/index/search?q=&type=&limit=&offset=
export function handleGetIndexSearch(ctx: RouteContext, projectIdRaw: string): void {
  const project = resolveProject(ctx, projectIdRaw);
  if (!project) return;
  const q = ctx.query.get("q") ?? ctx.query.get("query");
  if (q === null || q.trim().length === 0) {
    ctx.sendError(ctx.res, 400, "validation_failed", "query (q) is required.", ctx.origin);
    return;
  }
  try {
    const paths = resolveIndexPaths(ctx.storeRoot, project.id);
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
