import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type SessionDecisionTrace,
  readReplayTraces,
  readSessionDecisionTrace,
} from "@megasaver/output-filter";
import { toDecisionGraph } from "../../src/lib/decision-trace-graph.js";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { resolveSessionWorkspace, sendSessionResolveError } from "./_claude-session.js";

const TRACES_SUFFIX = "-traces";

// The overlay/cockpit identity carries no registry projectId; replay traces are
// keyed by it (`stats/<projectId>/…`). The only sound cwd→projectId bridge is a
// registry project whose rootPath equals this session's cwd. When none exists
// (the common overlay case, or no registry at all) we do NOT fabricate an id —
// we return an empty trace so the panel shows its honest empty state.
function resolveProjectId(ctx: RouteContext, cwd: string): string | null {
  const project = ctx.registry?.listProjects().find((p) => p.rootPath === cwd);
  return project?.id ?? null;
}

type DecisionTraceSessionSummary = {
  sessionId: string;
  outputs: number;
  latestCreatedAt: string | null;
};

// List every registry sessionId that has traces under stats/<projectId>/. Each
// `<sessionId>-traces` dir name yields the registry sessionId (a `mega session
// create` randomUUID) — the id-space the reader is actually keyed by, which the
// cockpit's transcript UUID never aligns with. Best-effort: an unreadable stats
// dir or trace file degrades to an empty/partial list, never a throw.
function listDecisionTraceSessions(
  storeRoot: string,
  projectId: string,
): DecisionTraceSessionSummary[] {
  const projectDir = join(storeRoot, "stats", projectId);
  let entries: string[];
  try {
    entries = readdirSync(projectDir);
  } catch {
    return [];
  }
  const summaries: DecisionTraceSessionSummary[] = [];
  for (const name of entries) {
    if (!name.endsWith(TRACES_SUFFIX)) continue;
    const sessionId = name.slice(0, -TRACES_SUFFIX.length);
    if (sessionId.length === 0) continue;
    const traces = readReplayTraces(join(projectDir, name, "replay-traces.jsonl"));
    let latestCreatedAt: string | null = null;
    for (const t of traces) {
      if (latestCreatedAt === null || t.createdAt > latestCreatedAt) {
        latestCreatedAt = t.createdAt;
      }
    }
    summaries.push({ sessionId, outputs: traces.length, latestCreatedAt });
  }
  // Newest-first. A dir with no readable trace lines (latest null) sorts last.
  summaries.sort((a, b) => (b.latestCreatedAt ?? "").localeCompare(a.latestCreatedAt ?? ""));
  return summaries;
}

export async function handleListDecisionTraceSessions(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const resolved = await resolveSessionWorkspace(ctx, dir, id);
  if (resolved === "unsafe" || resolved === "not_found") {
    sendSessionResolveError(ctx, resolved, dir, id);
    return;
  }
  try {
    const projectId = resolveProjectId(ctx, resolved.cwd);
    const sessions = projectId === null ? [] : listDecisionTraceSessions(ctx.storeRoot, projectId);
    ctx.sendJson(ctx.res, 200, { sessions }, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleGetDecisionTrace(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const resolved = await resolveSessionWorkspace(ctx, dir, id);
  if (resolved === "unsafe" || resolved === "not_found") {
    sendSessionResolveError(ctx, resolved, dir, id);
    return;
  }
  try {
    const projectId = resolveProjectId(ctx, resolved.cwd);
    // The reader is keyed by the REGISTRY sessionId, which the cockpit transcript
    // UUID never matches. The picked session id from the project-scoped picker is
    // the only sound key; without it we do NOT auto-map — return an empty graph.
    const pickedSessionId = ctx.query.get("session");
    const trace: SessionDecisionTrace =
      projectId === null || pickedSessionId === null || pickedSessionId.length === 0
        ? { projectId: projectId ?? "", sessionId: pickedSessionId ?? "", outputs: [] }
        : readSessionDecisionTrace(
            { root: ctx.storeRoot },
            {
              projectId,
              sessionId: pickedSessionId,
              workspaceKey: resolved.workspaceKey,
            },
          );
    const graph = toDecisionGraph(trace);
    ctx.sendJson(ctx.res, 200, graph, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
