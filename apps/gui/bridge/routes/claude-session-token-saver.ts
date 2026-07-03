import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MEGA_SAVER_CG_BLOCK_START,
  readTargetFile,
  renderContextGateBlockText,
  upsertContextGateBlockText,
  writeTargetFile,
} from "@megasaver/connectors-shared";
import { ContentStoreError, loadOverlayChunkSet } from "@megasaver/content-store";
import {
  nodeResolverDeps,
  resolveActivationScope,
  resolveWorkspaceTokenSaverSettings,
  writeActivation,
} from "@megasaver/context-gate";
import { type TokenSaverSettings, tokenSaverSettingsSchema } from "@megasaver/core";
import { modeToBudget, tokenSaverModeSchema, workspaceLabel } from "@megasaver/shared";
import {
  type StatsStore,
  readOverlayEvents,
  readOverlaySummary,
  readWorkspaceTokenSaverTotals,
} from "@megasaver/stats";
import { z } from "zod";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { readJsonBody } from "./_body.js";
import {
  type ResolvedSessionWorkspace,
  resolveSessionWorkspace,
  sendSessionResolveError,
} from "./_claude-session.js";

function statsStore(ctx: RouteContext): StatsStore {
  return { root: ctx.storeRoot };
}

// §4.4 overlay settings source: stats/<wk>/<lsid>.settings.json. Absent ⇒ null
// (the live route is read-only; the proxy on/off toggle stays on the legacy
// session route through F4). A malformed file reads as null rather than crashing.
function readOverlaySettings(
  ctx: RouteContext,
  resolved: ResolvedSessionWorkspace,
): TokenSaverSettings | null {
  const path = join(
    ctx.storeRoot,
    "stats",
    resolved.workspaceKey,
    `${resolved.liveSessionId}.settings.json`,
  );
  if (!existsSync(path)) return null;
  const parsed = tokenSaverSettingsSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  return parsed.success ? parsed.data : null;
}

const WORKSPACE_SAVER_BODY = z
  .object({ enabled: z.boolean(), mode: tokenSaverModeSchema, exact: z.boolean().optional() })
  .strict();

async function claudeMcpInstalled(ctx: RouteContext): Promise<boolean> {
  const status = await ctx.mcpOps.status();
  return status.agents.find((a) => a.agentId === "claude-code")?.mcpInstalled ?? false;
}

async function claudeMdHasBlock(cwd: string): Promise<boolean> {
  const existing = await readTargetFile(join(cwd, "CLAUDE.md"));
  return existing?.includes(MEGA_SAVER_CG_BLOCK_START) ?? false;
}

export async function handleWorkspaceSaverStatus(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const resolved = await resolveOr4xx(ctx, dir, id);
  if (!resolved) return;
  try {
    // Report the EFFECTIVE activation the saver hook resolves (repository family
    // inheritance included), not just the exact-cwd record.
    const effective = resolveWorkspaceTokenSaverSettings(
      ctx.storeRoot,
      resolved.cwd,
      nodeResolverDeps(),
    );
    const blockPresent = await claudeMdHasBlock(resolved.cwd);
    const mcpInstalled = await claudeMcpInstalled(ctx);
    ctx.sendJson(
      ctx.res,
      200,
      {
        enabled: effective.enabled,
        mode: effective.mode,
        source: effective.source,
        repositoryFamilyKey: effective.repositoryFamilyKey,
        familyUnavailableReason: effective.familyUnavailableReason,
        familyIdentityDiagnostic: effective.familyIdentityDiagnostic,
        blockPresent,
        mcpInstalled,
      },
      ctx.origin,
    );
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleWorkspaceSaverSet(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const resolved = await resolveOr4xx(ctx, dir, id);
  if (!resolved) return;

  let raw: unknown;
  try {
    raw = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = WORKSPACE_SAVER_BODY.safeParse(raw);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      "Invalid token-saver settings.",
      ctx.origin,
      parsed.error.issues,
    );
    return;
  }

  try {
    const { enabled, mode, exact } = parsed.data;

    // 1) Persist activation scope-aware: inside a Git repo this writes a family
    //    record (covers all worktrees); --exact and non-Git cwds write an exact
    //    record. Same shared writer the CLI + hook use, so they never drift.
    const scope = resolveActivationScope(resolved.cwd, exact ?? false);
    writeActivation(ctx.storeRoot, scope, enabled, mode);

    // 2) Upsert the CONTEXT_GATE block into <cwd>/CLAUDE.md (sentinel-bounded,
    //    atomic, symlink-refusing). Skip writing when disabling and no file
    //    exists, so we never create an empty CLAUDE.md.
    const claudeMdPath = join(resolved.cwd, "CLAUDE.md");
    const existing = await readTargetFile(claudeMdPath);
    const block = enabled
      ? renderContextGateBlockText({
          sessionId: "(workspace-wide)",
          projectId: workspaceLabel(resolved.cwd),
          mode,
          maxReturnedBytes: modeToBudget(mode),
        })
      : "";
    // When disabling a CLAUDE.md whose only content was the CG block,
    // upsertContextGateBlockText returns "" and we write a 0-byte file rather
    // than deleting it — matching `mega connector sync` semantics. We never
    // delete user files: an empty CLAUDE.md left behind is intentional.
    if (!(block === "" && existing === null)) {
      const next = upsertContextGateBlockText(existing ?? "", block);
      await writeTargetFile({ absPath: claudeMdPath, content: next });
    }

    const blockPresent = await claudeMdHasBlock(resolved.cwd);
    const mcpInstalled = await claudeMcpInstalled(ctx);
    const coverage =
      scope.kind === "repository"
        ? `repository family (covers all worktrees of ${scope.root}; a checkout's own exact override still wins)`
        : "this workspace only";
    ctx.sendJson(
      ctx.res,
      200,
      { enabled, mode, scope: scope.kind, coverage, blockPresent, mcpInstalled },
      ctx.origin,
    );
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

async function resolveOr4xx(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<ResolvedSessionWorkspace | null> {
  const resolved = await resolveSessionWorkspace(ctx, dir, id);
  if (resolved === "unsafe" || resolved === "not_found") {
    sendSessionResolveError(ctx, resolved, dir, id);
    return null;
  }
  return resolved;
}

export async function handleSessionTokenSaverStatus(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const resolved = await resolveOr4xx(ctx, dir, id);
  if (!resolved) return;
  try {
    const settings = readOverlaySettings(ctx, resolved);
    ctx.sendJson(ctx.res, 200, { enabled: settings?.enabled === true, settings }, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleSessionTokenSaverStats(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const resolved = await resolveOr4xx(ctx, dir, id);
  if (!resolved) return;
  try {
    const summary = readOverlaySummary(
      statsStore(ctx),
      resolved.workspaceKey,
      resolved.liveSessionId,
    );
    ctx.sendJson(ctx.res, 200, summary, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleWorkspaceTokenSaverStats(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const resolved = await resolveOr4xx(ctx, dir, id);
  if (!resolved) return;
  try {
    const totals = readWorkspaceTokenSaverTotals(statsStore(ctx), resolved.workspaceKey);
    ctx.sendJson(ctx.res, 200, totals, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleSessionTokenSaverEvents(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const resolved = await resolveOr4xx(ctx, dir, id);
  if (!resolved) return;
  try {
    const events = readOverlayEvents(
      statsStore(ctx),
      resolved.workspaceKey,
      resolved.liveSessionId,
    );
    events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    ctx.sendJson(ctx.res, 200, events, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleSessionTokenSaverEventBlob(
  ctx: RouteContext,
  dir: string,
  id: string,
  eventId: string,
): Promise<void> {
  const resolved = await resolveOr4xx(ctx, dir, id);
  if (!resolved) return;
  try {
    const events = readOverlayEvents(
      statsStore(ctx),
      resolved.workspaceKey,
      resolved.liveSessionId,
    );
    const event = events.find((e) => e.id === eventId);
    if (!event || event.chunkSetId === undefined) {
      ctx.sendError(
        ctx.res,
        404,
        "event_not_found",
        "Event not found, or it has no stored output.",
        ctx.origin,
      );
      return;
    }
    let chunkSet: Awaited<ReturnType<typeof loadOverlayChunkSet>>;
    try {
      chunkSet = await loadOverlayChunkSet({
        storeRoot: ctx.storeRoot,
        workspaceKey: resolved.workspaceKey,
        liveSessionId: resolved.liveSessionId,
        chunkSetId: event.chunkSetId,
      });
    } catch (err) {
      if (err instanceof ContentStoreError && err.code === "not_found") {
        ctx.sendError(
          ctx.res,
          404,
          "event_not_found",
          "Event not found, or it has no stored output.",
          ctx.origin,
        );
        return;
      }
      throw err;
    }
    const text = chunkSet.chunks.map((c) => c.text).join("\n");
    ctx.sendText(ctx.res, 200, text, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

const SESSION_TOKEN_SAVER_PATH =
  /^\/api\/claude-sessions\/([^/]+)\/([^/]+?)\/token-saver(?:\/(status|stats|events|workspace|workspace-stats)(?:\/([^/]+)\/(raw|sent))?)?$/;

export async function dispatchSessionTokenSaver(
  ctx: RouteContext,
  method: string,
  path: string,
  onMethodNotAllowed: () => void,
): Promise<boolean> {
  const match = path.match(SESSION_TOKEN_SAVER_PATH);
  if (!match) return false;
  const dir = decodeURIComponent(match[1] as string);
  const id = decodeURIComponent(match[2] as string);
  const segment = match[3];
  const eventId = match[4];
  const blob = match[5];

  if (segment === "workspace") {
    if (method === "GET") {
      await handleWorkspaceSaverStatus(ctx, dir, id);
      return true;
    }
    if (method === "POST") {
      await handleWorkspaceSaverSet(ctx, dir, id);
      return true;
    }
    onMethodNotAllowed();
    return true;
  }

  if (method !== "GET") {
    onMethodNotAllowed();
    return true;
  }

  if (segment === "status") {
    await handleSessionTokenSaverStatus(ctx, dir, id);
    return true;
  }
  if (segment === "stats") {
    await handleSessionTokenSaverStats(ctx, dir, id);
    return true;
  }
  if (segment === "workspace-stats") {
    await handleWorkspaceTokenSaverStats(ctx, dir, id);
    return true;
  }
  if (segment === "events" && eventId === undefined) {
    await handleSessionTokenSaverEvents(ctx, dir, id);
    return true;
  }
  if (segment === "events" && eventId !== undefined && (blob === "raw" || blob === "sent")) {
    await handleSessionTokenSaverEventBlob(ctx, dir, id, decodeURIComponent(eventId));
    return true;
  }
  return false;
}
