import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readBlocks, searchBlocks } from "@megasaver/indexer";
import { type WorkspaceKey, workspaceKeySchema } from "@megasaver/shared";
import type { RouteContext } from "../route-context.js";
import { intParam } from "./_query.js";
import { resolveWorkspaceKey } from "./_workspace.js";
import { resolveEffectiveIndexPaths } from "./workspace-index.js";

// GET /api/search?q=&type=&limit=&workspaceKey=
// Federates searchBlocks across workspace indexes. When workspaceKey is given,
// only that workspace is searched; otherwise all workspace indexes under the
// store are scanned and merged by BM25 score. The route never branches on a
// harness id — that distinction lives in the shared indexer layer
// (harness-agnostic bridge rule). Security: workspaceKey is 16-hex-validated;
// q required; limit 1..200; no path escapes storeRoot/index/.
export function handleGlobalSearch(ctx: RouteContext): void {
  const q = ctx.query.get("q") ?? ctx.query.get("query");
  if (q === null || q.trim().length === 0) {
    ctx.sendError(ctx.res, 400, "validation_failed", "query (q) is required.", ctx.origin);
    return;
  }
  const limit = intParam(ctx.query.get("limit"), 20, 1, 200);
  const offset = intParam(ctx.query.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  const typeRaw = ctx.query.get("type");
  const typeFilter =
    typeRaw !== null && typeRaw.length > 0
      ? (typeRaw as NonNullable<Parameters<typeof searchBlocks>[1]["type"]>)
      : undefined;
  const workspaceKeyRaw = ctx.query.get("workspaceKey");
  try {
    const keys: string[] = [];
    if (workspaceKeyRaw !== null && workspaceKeyRaw.length > 0) {
      const key = resolveWorkspaceKey(ctx, workspaceKeyRaw);
      if (!key) return;
      keys.push(key);
    } else {
      try {
        const entries = readdirSync(join(ctx.storeRoot, "index"), { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory() && workspaceKeySchema.safeParse(e.name).success) keys.push(e.name);
        }
        keys.sort();
      } catch {}
    }
    type Hit = ReturnType<typeof searchBlocks>[number];
    const all: { hit: Hit; workspaceKey: string }[] = [];
    for (const key of keys) {
      let blocks: ReturnType<typeof readBlocks>;
      try {
        const paths = resolveEffectiveIndexPaths(ctx, key as WorkspaceKey);
        blocks = readBlocks(paths);
      } catch {
        continue;
      }
      if (blocks.length === 0) continue;
      const hits = searchBlocks(blocks, {
        text: q.trim(),
        ...(typeFilter ? { type: typeFilter } : {}),
      });
      for (const hit of hits) all.push({ hit, workspaceKey: key });
    }
    all.sort((a, b) => b.hit.score - a.hit.score);
    const page = all.slice(offset, offset + limit).map(({ hit, workspaceKey }) => ({
      block: hit.block,
      score: hit.score,
      workspaceKey,
    }));
    ctx.sendJson(ctx.res, 200, { query: q.trim(), total: all.length, hits: page }, ctx.origin);
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
