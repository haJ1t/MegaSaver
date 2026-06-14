import type { RouteContext } from "../route-context.js";
import { handleGetAudit } from "./audit.js";
import { handleGetContext } from "./context.js";
import { handleGetIndexSearch, handleGetIndexStatus } from "./index-routes.js";
import { handleGetRules } from "./rules.js";
import { handleGetTasks } from "./tasks.js";
import { handleGetTools } from "./tools.js";

// /api/projects/:id/<segment>[/search] — all read-only (GET). Mirrors the
// dispatchMcpSetup shape so handler.ts stays thin.
const PROJECT_SCOPED_PATH =
  /^\/api\/projects\/([^/]+)\/(audit|rules|context|tasks|tools|index)(?:\/(search))?$/;

export function dispatchProjectScoped(
  ctx: RouteContext,
  method: string,
  path: string,
  onMethodNotAllowed: () => void,
): boolean {
  const match = path.match(PROJECT_SCOPED_PATH);
  if (!match) return false;
  const projectId = match[1] as string;
  const segment = match[2] as string;
  const sub = match[3];

  if (method !== "GET") {
    onMethodNotAllowed();
    return true;
  }

  if (segment === "index") {
    if (sub === "search") handleGetIndexSearch(ctx, projectId);
    else handleGetIndexStatus(ctx, projectId);
    return true;
  }
  // The remaining segments have no sub-path; a stray `.../search` on them never
  // matches the regex (sub only allowed after `index`), so no guard needed.
  if (segment === "audit") handleGetAudit(ctx, projectId);
  else if (segment === "rules") handleGetRules(ctx, projectId);
  else if (segment === "context") handleGetContext(ctx, projectId);
  else if (segment === "tasks") handleGetTasks(ctx, projectId);
  else if (segment === "tools") handleGetTools(ctx, projectId);
  return true;
}
