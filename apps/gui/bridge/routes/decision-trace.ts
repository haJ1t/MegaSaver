import { type SessionDecisionTrace, readSessionDecisionTrace } from "@megasaver/output-filter";
import { toDecisionGraph } from "../../src/lib/decision-trace-graph.js";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { resolveSessionWorkspace, sendSessionResolveError } from "./_claude-session.js";

// The overlay/cockpit identity carries no registry projectId; replay traces are
// keyed by it (`stats/<projectId>/…`). The only sound cwd→projectId bridge is a
// registry project whose rootPath equals this session's cwd. When none exists
// (the common overlay case, or no registry at all) we do NOT fabricate an id —
// we return an empty trace so the panel shows its honest empty state.
function resolveProjectId(ctx: RouteContext, cwd: string): string | null {
  const project = ctx.registry?.listProjects().find((p) => p.rootPath === cwd);
  return project?.id ?? null;
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
    const trace: SessionDecisionTrace =
      projectId === null
        ? { projectId: "", sessionId: resolved.liveSessionId, outputs: [] }
        : readSessionDecisionTrace(
            { root: ctx.storeRoot },
            {
              projectId,
              sessionId: resolved.liveSessionId,
              workspaceKey: resolved.workspaceKey,
            },
          );
    const graph = toDecisionGraph(trace);
    ctx.sendJson(ctx.res, 200, graph, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
