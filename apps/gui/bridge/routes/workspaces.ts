import { listSessions } from "../claude-sessions/reader.js";
import { groupSessionsByWorkspace } from "../claude-sessions/workspace.js";
import type { RouteContext } from "../route-context.js";
import { intParam } from "./_query.js";
import { sendReadError } from "./claude-sessions.js";

export async function handleListWorkspaces(ctx: RouteContext): Promise<void> {
  try {
    const offset = intParam(ctx.query.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(ctx.query.get("limit"), 50, 1, 200);
    const sessions = await listSessions(ctx.claudeProjectsDir, ctx.claudeSessionsMetaDir, {
      limit,
      offset,
    });
    ctx.sendJson(ctx.res, 200, groupSessionsByWorkspace(sessions), ctx.origin);
  } catch (err) {
    sendReadError(ctx, err);
  }
}
