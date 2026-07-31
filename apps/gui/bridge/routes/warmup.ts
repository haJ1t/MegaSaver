import type { RouteContext } from "../route-context.js";
import { resolveSessionWorkspace, sendSessionResolveError } from "./_claude-session.js";

export async function handleGetSessionWarmup(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const resolved = await resolveSessionWorkspace(ctx, dir, id);
  if (resolved === "unsafe" || resolved === "not_found") {
    sendSessionResolveError(ctx, resolved, dir, id);
    return;
  }

  ctx.sendJson(
    ctx.res,
    200,
    {
      workspaceKey: resolved.workspaceKey,
      liveSessionId: resolved.liveSessionId,
      brief: `Warm start brief for ${resolved.cwd}. Ready for instant agent onboarding.`,
    },
    ctx.origin,
  );
}
