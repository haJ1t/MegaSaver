import { workspaceKeySchema } from "@megasaver/shared";
import { resolveCodexTranscriptPath } from "../claude-sessions/codex-transcript.js";
import {
  readHarnessTranscript,
  resolveHarnessTranscriptPath,
} from "../claude-sessions/harness-transcript.js";
import { scanAllHarnessSessions } from "../claude-sessions/multi-harness-scanner.js";
import { resolvePiTranscriptPath } from "../claude-sessions/pi-transcript.js";
import {
  listSessions,
  readTranscript,
  safeSessionPath,
  tailTranscript,
} from "../claude-sessions/reader.js";
import { aggregateTelemetry } from "../claude-sessions/telemetry.js";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { readUserProjects } from "../user-projects-store.js";
import { intParam } from "./_query.js";

// These routes are read-only; a filesystem errno (EACCES/EPERM/etc.) must map to
// internal_error (500), not handleCaughtError's store_write_failed.
export function sendReadError(ctx: RouteContext, err: unknown): void {
  if (err instanceof Error && typeof (err as NodeJS.ErrnoException).code === "string") {
    ctx.sendError(ctx.res, 500, "internal_error", err.message, ctx.origin);
    return;
  }
  handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
}

async function tryHarnessFallbackTranscript(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<{
  projectLabel: string;
  messages: { role: "user" | "assistant"; ts: string; blocks: { kind: "text"; text: string }[] }[];
  byteLength: number;
  dir: string;
  id: string;
} | null> {
  // First try the canonical Claude transcript (covers the file-backed session that
  // fix/indexer-and-cli-bugs's mesh-presence dash-dir patch now correctly addresses
  // for e06ffda0 etc). When that succeeds we return the real messages — the caller
  // (handleGetClaudeSession/telemetry/stream) will have already handled it, but
  // this makes the fallback safe if called directly.
  try {
    const t = await readTranscript(ctx.claudeProjectsDir, dir, id);
    if (t)
      return {
        dir: t.dir,
        id: t.id,
        projectLabel: t.projectLabel,
        byteLength: t.byteLength,
        messages: t.messages as unknown as {
          role: "user" | "assistant";
          ts: string;
          blocks: { kind: "text"; text: string }[];
        }[],
      };
  } catch {}
  // Also try resolving via scan and then reading the dash-encoded transcript
  // (covers the case where dir is still the legacy hash workspaceKey).
  try {
    const scanned = await scanAllHarnessSessions({
      ...(ctx.storeRoot ? { storeRoot: ctx.storeRoot } : {}),
      ...(ctx.homeDir !== undefined ? { homeDir: ctx.homeDir } : {}),
    });
    const match = scanned.find((s) => s.id === id);
    if (!match) return null;
    // If this is a claude-code session, try its real dash dir transcript before placeholder.
    if (match.harness === "claude-code" && match.projectLabel) {
      const dashDir = `-${match.projectLabel.slice(1).replace(/\//g, "-")}`;
      for (const candDir of [dashDir, match.dir]) {
        try {
          const real = await readTranscript(ctx.claudeProjectsDir, candDir, id);
          if (real)
            return {
              dir: real.dir,
              id: real.id,
              projectLabel: real.projectLabel,
              byteLength: real.byteLength,
              messages: real.messages as unknown as {
                role: "user" | "assistant";
                ts: string;
                blocks: { kind: "text"; text: string }[];
              }[],
            };
        } catch {}
      }
    }
    // Harness-agnostic: try real parsers (Codex/Pi/OpenCode) before synthetic placeholder.
    const home = ctx.homeDir ?? process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
    if (home) {
      try {
        const realHarness = await readHarnessTranscript(home, id);
        if (realHarness && realHarness.messages.length > 0) {
          return {
            dir: realHarness.dir,
            id: realHarness.id,
            projectLabel: realHarness.projectLabel,
            byteLength: realHarness.byteLength,
            messages: realHarness.messages as unknown as {
              role: "user" | "assistant";
              ts: string;
              blocks: { kind: "text"; text: string }[];
            }[],
          };
        }
      } catch {}
    }
    const harnessLabel = match.harnessName ?? match.harness ?? "external harness";
    return {
      dir: match.dir,
      id: match.id,
      projectLabel: match.projectLabel,
      byteLength: 0,
      messages: [
        {
          role: "assistant" as const,
          ts: new Date(match.mtimeMs).toISOString(),
          blocks: [
            {
              kind: "text" as const,
              text: `This session is managed by ${harnessLabel} and is not stored as a Claude Code transcript.

Open it in its native app to resume. Metadata: ${match.title}`,
            },
          ],
        },
      ],
    };
  } catch {
    return null;
  }
}
export async function handleListClaudeSessions(ctx: RouteContext): Promise<void> {
  try {
    const offset = intParam(ctx.query.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(ctx.query.get("limit"), 50, 1, 200);
    const harness = ctx.query.get("harness") ?? undefined;
    const rawKey = ctx.query.get("workspaceKey") ?? undefined;
    let workspaceKey: string | undefined;
    if (rawKey !== undefined && rawKey.length > 0) {
      const parsed = workspaceKeySchema.safeParse(rawKey);
      if (!parsed.success) {
        ctx.sendError(
          ctx.res,
          400,
          "validation_failed",
          "Invalid workspaceKey.",
          ctx.origin,
          parsed.error.issues,
        );
        return;
      }
      workspaceKey = parsed.data;
    }
    // Manual workspace selection: if the user has chosen folders (user-projects.json
    // non-empty), restrict sessions to those roots (prefix). Empty store → no
    // filter so legacy/test callers still see all sessions.
    let allowedRoots: string[] | undefined;
    try {
      const roots = await readUserProjects(ctx.storeRoot);
      if (roots.length > 0) allowedRoots = roots;
    } catch {}
    const listOpts: {
      limit: number;
      offset: number;
      storeRoot?: string;
      harness?: string;
      workspaceKey?: string;
      allowedRoots?: string[];
      homeDir?: string;
    } = {
      limit,
      offset,
      storeRoot: ctx.storeRoot,
      ...(ctx.homeDir !== undefined ? { homeDir: ctx.homeDir } : {}),
      ...(allowedRoots ? { allowedRoots } : {}),
    };
    if (harness && harness.length > 0) listOpts.harness = harness;
    if (workspaceKey) listOpts.workspaceKey = workspaceKey;
    const sessions = await listSessions(ctx.claudeProjectsDir, ctx.claudeSessionsMetaDir, listOpts);
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
    if (transcript) {
      ctx.sendJson(ctx.res, 200, transcript, ctx.origin);
      return;
    }
    const fallback = await tryHarnessFallbackTranscript(ctx, dir, id);
    if (fallback) {
      ctx.sendJson(ctx.res, 200, fallback, ctx.origin);
      return;
    }
    ctx.sendError(
      ctx.res,
      404,
      "claude_session_not_found",
      `Claude Code session not found: ${dir}/${id}`,
      ctx.origin,
    );
  } catch (err) {
    sendReadError(ctx, err);
  }
}

export async function handleGetClaudeSessionTelemetry(
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
    if (transcript) {
      ctx.sendJson(ctx.res, 200, aggregateTelemetry(transcript.messages), ctx.origin);
      return;
    }
    const fallback = await tryHarnessFallbackTranscript(ctx, dir, id);
    if (fallback) {
      ctx.sendJson(ctx.res, 200, aggregateTelemetry(fallback.messages), ctx.origin);
      return;
    }
    ctx.sendError(
      ctx.res,
      404,
      "claude_session_not_found",
      `Claude Code session not found: ${dir}/${id}`,
      ctx.origin,
    );
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
      const fallback = await tryHarnessFallbackTranscript(ctx, dir, id);
      if (fallback) {
        const headers: Record<string, string> = {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-security-policy": "default-src 'self'",
          vary: "origin",
        };
        if (ctx.origin) headers["access-control-allow-origin"] = ctx.origin;
        ctx.res.writeHead(200, headers);
        // If this is a real harness transcript with backing file, tail it incrementally instead of closing.
        const home = ctx.homeDir ?? process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
        let harnessPath: string | null = null;
        let harnessOffset = fallback.byteLength;
        let isJsonlTail = false;
        if (home && fallback.messages.length > 1) {
          try {
            const resolved = await resolveHarnessTranscriptPath(home, id);
            if (resolved && resolved.kind === "jsonl") {
              harnessPath = resolved.path;
              harnessOffset = resolved.offset;
              isJsonlTail = true;
            }
          } catch {}
          if (!harnessPath) {
            try {
              const c = await resolveCodexTranscriptPath(home, id);
              if (c) {
                harnessPath = c.path;
                harnessOffset = c.offset;
                isJsonlTail = true;
              }
            } catch {}
          }
          if (!harnessPath) {
            try {
              const pp = await resolvePiTranscriptPath(home, id);
              if (pp) {
                harnessPath = pp.path;
                harnessOffset = pp.offset;
                isJsonlTail = true;
              }
            } catch {}
          }
        }
        let closedInner = false;
        const sendInner = (event: string, data: unknown): void => {
          if (closedInner) return;
          ctx.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        sendInner("snapshot", { projectLabel: fallback.projectLabel, messages: fallback.messages });
        if (isJsonlTail && harnessPath) {
          const hb = setInterval(() => {
            if (!closedInner) ctx.res.write(": ping\n\n");
          }, HEARTBEAT_MS);
          const disposeInner = tailTranscript(harnessPath, harnessOffset, (message) =>
            sendInner("message", message),
          );
          const cleanupInner = (): void => {
            if (closedInner) return;
            closedInner = true;
            clearInterval(hb);
            disposeInner();
            ctx.res.end();
          };
          ctx.req.on("close", cleanupInner);
          ctx.req.on("aborted", cleanupInner);
          return;
        }
        if (fallback.messages.length > 1) {
          // Real harness transcript backed by SQLite (OpenCode) or other non-JSONL store:
          // no file to tail, poll the dispatcher for new messages.
          const hb2 = setInterval(() => {
            if (!closedInner) ctx.res.write(": ping\n\n");
          }, HEARTBEAT_MS);
          let seen2 = fallback.messages.length;
          const poll2 = setInterval(async () => {
            if (closedInner) return;
            try {
              const fresh = await readHarnessTranscript(home, id);
              if (fresh && fresh.messages.length > seen2) {
                for (let i = seen2; i < fresh.messages.length; i++)
                  sendInner("message", fresh.messages[i]);
                seen2 = fresh.messages.length;
              }
            } catch {}
          }, 750);
          const cleanup2 = (): void => {
            if (closedInner) return;
            closedInner = true;
            clearInterval(hb2);
            clearInterval(poll2);
            ctx.res.end();
          };
          ctx.req.on("close", cleanup2);
          ctx.req.on("aborted", cleanup2);
          return;
        }
        ctx.res.write("event: end\ndata: {}\n\n");
        ctx.res.end();
        return;
      }
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
