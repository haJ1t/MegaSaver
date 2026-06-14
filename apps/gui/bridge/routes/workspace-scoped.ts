import type { RouteContext } from "../route-context.js";
import { resolveWorkspaceKey } from "./_workspace.js";
import { handleGetWorkspaceContext } from "./workspace-context.js";
import { handleGetWorkspaceIndexSearch, handleGetWorkspaceIndexStatus } from "./workspace-index.js";
import { handleGetWorkspacePermissions } from "./workspace-permissions.js";
import { handleGetWorkspaceRules } from "./workspace-rules.js";
import { handleGetWorkspaceTools } from "./workspace-tools.js";

// /api/workspaces/:key/<segment>[/search] — all read-only (GET). Mirrors
// dispatchProjectScoped so handler.ts stays thin. The :key is schema-validated
// (16 hex chars), never used as a raw fs segment.
const WORKSPACE_SCOPED_PATH =
  /^\/api\/workspaces\/([^/]+)\/(index|context|rules|tools|permissions)(?:\/(search))?$/;

export async function dispatchWorkspaceScoped(
  ctx: RouteContext,
  method: string,
  path: string,
  onMethodNotAllowed: () => void,
): Promise<boolean> {
  const match = path.match(WORKSPACE_SCOPED_PATH);
  if (!match) return false;
  const keyRaw = match[1] as string;
  const segment = match[2] as string;
  const sub = match[3];

  if (method !== "GET") {
    onMethodNotAllowed();
    return true;
  }

  const key = resolveWorkspaceKey(ctx, keyRaw);
  if (!key) return true;

  if (segment === "index") {
    if (sub === "search") handleGetWorkspaceIndexSearch(ctx, key);
    else handleGetWorkspaceIndexStatus(ctx, key);
    return true;
  }
  if (segment === "rules") {
    handleGetWorkspaceRules(ctx, key);
    return true;
  }
  if (segment === "tools") {
    handleGetWorkspaceTools(ctx, key);
    return true;
  }
  if (segment === "context") {
    handleGetWorkspaceContext(ctx, key);
    return true;
  }
  if (segment === "permissions") {
    await handleGetWorkspacePermissions(ctx, key);
    return true;
  }
  return false;
}
