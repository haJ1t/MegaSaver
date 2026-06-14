import {
  listSessions,
  readTranscript,
  safeSessionPath,
  tailTranscript,
} from "../claude-sessions/reader.js";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { intParam } from "./_query.js";

// These routes are read-only; a filesystem errno (EACCES/EPERM/etc.) must map to
// internal_error (500), not handleCaughtError's store_write_failed.
function sendReadError(ctx: RouteContext, err: unknown): void {
  if (err instanceof Error && typeof (err as NodeJS.ErrnoException).code === "string") {
    ctx.sendError(ctx.res, 500, "internal_error", err.message, ctx.origin);
    return;
  }
  handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
}

export async function handleListClaudeSessions(ctx: RouteContext): Promise<void> {
  try {
    const offset = intParam(ctx.query.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(ctx.query.get("limit"), 50, 1, 200);
    const sessions = await listSessions(ctx.claudeProjectsDir, ctx.claudeSessionsMetaDir, {
      limit,
      offset,
    });
    ctx.sendJson(ctx.res, 200, sessions, ctx.origin);
  } catch (err) {
    sendReadError(ctx, err);
  }
}

export async function handleGetClaudeSession(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  // Pre-validate to surface path-traversal as 400 distinctly from not-found (404);
  // readTranscript re-runs safeSessionPath internally.
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
    sendReadError(ctx, err);
  }
}

const HEARTBEAT_MS = 15000;

export async function handleStreamClaudeSession(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  let path: string;
  let snapshot: Awaited<ReturnType<typeof readTranscript>>;
  try {
    const resolved = await safeSessionPath(ctx.claudeProjectsDir, dir, id);
    if (resolved === null) {
      ctx.sendError(ctx.res, 400, "validation_failed", "Invalid session path.", ctx.origin);
      return;
    }
    snapshot = await readTranscript(ctx.claudeProjectsDir, dir, id);
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
    path = resolved;
  } catch (err) {
    sendReadError(ctx, err);
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

  // Guarded against a late write from an in-flight tail drain after cleanup ran:
  // writing past res.end() is a harmless no-op on Node, but skipping it is cleaner.
  let closed = false;
  const send = (event: string, data: unknown): void => {
    if (closed) return;
    ctx.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("snapshot", { projectLabel: snapshot.projectLabel, messages: snapshot.messages });

  const heartbeat = setInterval(() => {
    if (!closed) ctx.res.write(": ping\n\n");
  }, HEARTBEAT_MS);
  const dispose = tailTranscript(path, snapshot.byteLength, (message) => send("message", message));

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
