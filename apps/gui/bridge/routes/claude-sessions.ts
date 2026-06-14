import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import {
  listSessions,
  readTranscript,
  safeSessionPath,
  tailTranscript,
} from "../claude-sessions/reader.js";
import { intParam } from "./_query.js";

export async function handleListClaudeSessions(ctx: RouteContext): Promise<void> {
  try {
    const offset = intParam(ctx.query.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(ctx.query.get("limit"), 50, 1, 200);
    const sessions = await listSessions(ctx.claudeProjectsDir, { limit, offset });
    ctx.sendJson(ctx.res, 200, sessions, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleGetClaudeSession(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  if ((await safeSessionPath(ctx.claudeProjectsDir, dir, id)) === null) {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid session path.", ctx.origin);
    return;
  }
  try {
    const transcript = await readTranscript(ctx.claudeProjectsDir, dir, id);
    if (!transcript) {
      ctx.sendError(
        ctx.res,
        404,
        "claude_session_not_found",
        `Claude Code session not found: ${dir}/${id}`,
        ctx.origin,
      );
      return;
    }
    ctx.sendJson(ctx.res, 200, transcript, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

const HEARTBEAT_MS = 15000;

export async function handleStreamClaudeSession(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const path = await safeSessionPath(ctx.claudeProjectsDir, dir, id);
  if (path === null) {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid session path.", ctx.origin);
    return;
  }
  const snapshot = await readTranscript(ctx.claudeProjectsDir, dir, id);
  if (!snapshot) {
    ctx.sendError(
      ctx.res,
      404,
      "claude_session_not_found",
      `Claude Code session not found: ${dir}/${id}`,
      ctx.origin,
    );
    return;
  }

  const headers: Record<string, string> = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-security-policy": "default-src 'self'",
    vary: "origin",
  };
  if (ctx.origin) headers["access-control-allow-origin"] = ctx.origin;
  ctx.res.writeHead(200, headers);

  const send = (event: string, data: unknown): void => {
    ctx.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("snapshot", { projectLabel: snapshot.projectLabel, messages: snapshot.messages });

  const heartbeat = setInterval(() => ctx.res.write(": ping\n\n"), HEARTBEAT_MS);
  const dispose = tailTranscript(path, snapshot.byteLength, (message) => send("message", message));

  let closed = false;
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    dispose();
    ctx.res.end();
  };
  ctx.req.on("close", cleanup);
  ctx.req.on("aborted", cleanup);
}
