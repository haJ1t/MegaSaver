import { encodeWorkspaceKey } from "@megasaver/shared";
import { readTranscript, safeSessionPath } from "../claude-sessions/reader.js";
import type { RouteContext } from "../route-context.js";

export type ResolvedSessionWorkspace = {
  workspaceKey: string;
  liveSessionId: string;
  cwd: string;
};

// §4.5 resolution contract. The (dir, id) from the URL are the ONLY untrusted
// inputs: (1) safeSessionPath gates traversal → 400; (2) the transcript's cwd
// derives the workspaceKey server-side → 404 when the session has no surfaced
// transcript/cwd. workspaceKey/liveSessionId are never client-supplied.
export async function resolveSessionWorkspace(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<ResolvedSessionWorkspace | "unsafe" | "not_found"> {
  const path = await safeSessionPath(ctx.claudeProjectsDir, dir, id);
  if (path === null) return "unsafe";

  const transcript = await readTranscript(ctx.claudeProjectsDir, dir, id);
  if (transcript === null || transcript.projectLabel.length === 0) return "not_found";

  return {
    workspaceKey: encodeWorkspaceKey(transcript.projectLabel),
    liveSessionId: id,
    cwd: transcript.projectLabel,
  };
}

// Maps the resolver's failure tokens onto the standard 400/404 responses and
// returns true when it sent a response (caller should stop).
export function sendSessionResolveError(
  ctx: RouteContext,
  outcome: "unsafe" | "not_found",
  dir: string,
  id: string,
): void {
  if (outcome === "unsafe") {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      `Invalid session path: ${dir}/${id}`,
      ctx.origin,
    );
    return;
  }
  ctx.sendError(
    ctx.res,
    404,
    "claude_session_not_found",
    `Claude session not found: ${dir}/${id}`,
    ctx.origin,
  );
}
