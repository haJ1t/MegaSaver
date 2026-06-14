import type { RouteContext } from "../route-context.js";
import { resolveWorkspaceKey } from "./_workspace.js";
import { handleGetWorkspaceRules } from "./workspace-rules.js";

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

  if (method !== "GET") {
    onMethodNotAllowed();
    return true;
  }

  const key = resolveWorkspaceKey(ctx, keyRaw);
  if (!key) return true;

  if (segment === "rules") {
    handleGetWorkspaceRules(ctx, key);
    return true;
  }
  // index/context/tools/permissions are wired in Tasks 7, 9, 10, 11.
  return false;
}
