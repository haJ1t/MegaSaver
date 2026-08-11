import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildLiveTable } from "@megasaver/daemon";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { readOverlaySummary } from "@megasaver/stats";
import { z } from "zod";
import type { RouteContext } from "../route-context.js";

const rawSessionSchema = z
  .object({
    liveSessionId: z.string().min(1),
    agent: z.string().min(1),
    cwd: z.string().min(1),
    branch: z.string().optional(),
    task: z.string().optional(),
    lastSeenAt: z.string().datetime({ offset: true }),
    lastHookEvent: z.string().optional(),
  })
  .strict();

const rawFileSchema = z.array(rawSessionSchema);

function liveSessionsPath(storeRoot: string): string {
  return join(storeRoot, "daemon", "live-sessions.json");
}

export async function handleSessionsLive(ctx: RouteContext): Promise<void> {
  const storeRoot = ctx.storeRoot;
  let rawSessions: z.infer<typeof rawFileSchema> | null = null;
  const path = liveSessionsPath(storeRoot);
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const parsed = rawFileSchema.safeParse(raw);
      if (parsed.success) rawSessions = parsed.data;
    } catch {
      rawSessions = null;
    }
  }

  if (!rawSessions || rawSessions.length === 0) {
    ctx.sendJson(
      ctx.res,
      200,
      { version: 1, sessions: [], total: 0, warnings: ["daemon not running"] },
      ctx.origin,
    );
    return;
  }

  const statsBurn = new Map<string, number | null>();
  for (const s of rawSessions) {
    try {
      const wk = encodeWorkspaceKey(s.cwd);
      const summary = readOverlaySummary({ root: storeRoot }, wk, s.liveSessionId);
      statsBurn.set(s.liveSessionId, summary ? summary.bytesSavedTotal : null);
    } catch {
      statsBurn.set(s.liveSessionId, null);
    }
  }

  const sessions = rawSessions.map((s) => ({
    liveSessionId: s.liveSessionId,
    agent: s.agent,
    cwd: s.cwd,
    lastSeenAt: s.lastSeenAt,
    ...(s.branch !== undefined ? { branch: s.branch } : {}),
    ...(s.task !== undefined ? { task: s.task } : {}),
    ...(s.lastHookEvent !== undefined ? { lastHookEvent: s.lastHookEvent } : {}),
  }));
  const table = buildLiveTable({
    sessions,
    statsBurn,
    now: () => Date.now(),
  });

  ctx.sendJson(ctx.res, 200, table, ctx.origin);
}
