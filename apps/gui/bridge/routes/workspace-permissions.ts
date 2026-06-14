import { join } from "node:path";
import { loadProjectPermissions } from "@megasaver/context-gate";
import { workspaceProjectId } from "@megasaver/indexer";
import {
  type EvaluateCommandResult,
  type EvaluatePathReadResult,
  PolicyLoadError,
  type ProjectPermissions,
  evaluateCommand,
  evaluatePathRead,
} from "@megasaver/policy";
import type { WorkspaceKey } from "@megasaver/shared";
import { listSessions } from "../claude-sessions/reader.js";
import { groupSessionsByWorkspace } from "../claude-sessions/workspace.js";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { assertCwdContains } from "../workspace-resolver.js";

type PermissionsResponse = {
  loaded: boolean;
  evaluation?: {
    command?: EvaluateCommandResult;
    pathRead?: EvaluatePathReadResult;
  };
};

// GET /api/workspaces/:key/permissions?command=&path=
// Resolves the real cwd for :key from the derived live-workspace listing (R4:
// never from the URL), then reads <cwd>/.megasaver/permissions.yaml. Absent file
// → loaded:false; malformed file → 500 policy_load_failed. Optional command/path
// run the pure baseline+overlay policy evaluators.
export async function handleGetWorkspacePermissions(
  ctx: RouteContext,
  key: WorkspaceKey,
): Promise<void> {
  let cwd: string | null;
  try {
    cwd = await resolveCwdForKey(ctx, key);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
    return;
  }
  if (cwd === null) {
    ctx.sendJson(ctx.res, 200, { loaded: false } satisfies PermissionsResponse, ctx.origin);
    return;
  }

  // Defence-in-depth: the file we are about to read must stay inside cwd.
  const permissionsFile = join(cwd, ".megasaver", "permissions.yaml");
  if (!(await assertCwdContains(cwd, permissionsFile))) {
    ctx.sendJson(ctx.res, 200, { loaded: false } satisfies PermissionsResponse, ctx.origin);
    return;
  }

  let permissions: ProjectPermissions | null;
  try {
    permissions = loadProjectPermissions(cwd);
  } catch (err) {
    if (err instanceof PolicyLoadError) {
      ctx.sendError(ctx.res, 500, "policy_load_failed", err.message, ctx.origin);
      return;
    }
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
    return;
  }

  if (permissions === null) {
    ctx.sendJson(ctx.res, 200, { loaded: false } satisfies PermissionsResponse, ctx.origin);
    return;
  }

  const project = workspaceProjectId(key);
  const evaluation: NonNullable<PermissionsResponse["evaluation"]> = {};
  const command = ctx.query.get("command");
  if (command !== null && command.trim().length > 0) {
    evaluation.command = evaluateCommand({ command, args: [], project, permissions });
  }
  const path = ctx.query.get("path");
  if (path !== null && path.trim().length > 0) {
    evaluation.pathRead = evaluatePathRead({ path, project, permissions });
  }

  const body: PermissionsResponse = { loaded: true };
  if (Object.keys(evaluation).length > 0) body.evaluation = evaluation;
  ctx.sendJson(ctx.res, 200, body, ctx.origin);
}

// The derived workspaceKey → cwd cache (R4): group the live sessions by cwd and
// match :key. Returns null when no live session maps to this key.
async function resolveCwdForKey(ctx: RouteContext, key: WorkspaceKey): Promise<string | null> {
  const sessions = await listSessions(ctx.claudeProjectsDir, ctx.claudeSessionsMetaDir, {
    limit: Number.MAX_SAFE_INTEGER,
    offset: 0,
  });
  const match = groupSessionsByWorkspace(sessions).find((w) => w.key === key);
  return match ? match.label : null;
}
