import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { RouteContext } from "../route-context.js";

/**
 * GET /api/fs/browse?path=<absolute>
 * Lists child directories of the given path. When path is omitted/empty,
 * defaults to the user's home (ctx.homeDir in tests, otherwise os.homedir()).
 * Response: { path: string, parent: string | null, entries: { name:string, path:string }[] }
 */
export async function handleBrowseFs(ctx: RouteContext): Promise<void> {
  const raw = ctx.query.get("path") ?? "";
  let target: string;
  if (!raw || raw.trim().length === 0) {
    const home = ctx.homeDir ?? homedir();
    target = home;
  } else {
    target = raw.trim();
  }
  const resolved = resolve(target);
  try {
    const s = await stat(resolved);
    if (!s.isDirectory()) {
      ctx.sendError(ctx.res, 400, "validation_failed", `Not a directory: ${resolved}`, ctx.origin);
      return;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      msg.includes(resolved) ? msg : `Path does not exist: ${resolved}`,
      ctx.origin,
    );
    return;
  }
  let entries: { name: string; path: string }[] = [];
  try {
    const dirents = await readdir(resolved, { withFileTypes: true });
    entries = dirents
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, path: join(resolved, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.sendError(ctx.res, 500, "internal_error", msg, ctx.origin);
    return;
  }
  const parent = resolved === dirname(resolved) ? null : dirname(resolved);
  ctx.sendJson(ctx.res, 200, { path: resolved, parent, entries }, ctx.origin);
}
