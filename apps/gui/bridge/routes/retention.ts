import { deleteChunkSet, listChunkSets } from "@megasaver/content-store";
import type { Session } from "@megasaver/core";
import { type ProjectId, type SessionId, sessionIdSchema } from "@megasaver/shared";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { CLEAR_RETENTION_BODY, PRUNE_RETENTION_BODY, zodErrorMessage } from "../zod-schemas.js";
import { readJsonBody } from "./_body.js";

type RetentionSummary = {
  chunkSets: number;
  totalBytes: number;
  oldestAt: string | null;
};

function resolveSession(ctx: RouteContext, idRaw: string): Session | null {
  const idParse = sessionIdSchema.safeParse(idRaw);
  if (!idParse.success) {
    ctx.sendError(ctx.res, 404, "session_not_found", `Session not found: ${idRaw}`, ctx.origin);
    return null;
  }
  const session = ctx.registry.getSession(idParse.data);
  if (!session) {
    ctx.sendError(ctx.res, 404, "session_not_found", `Session not found: ${idRaw}`, ctx.origin);
    return null;
  }
  return session;
}

// Summarise the session's stored raw output. Always scoped to projectId +
// sessionId — retention never reads or touches another session's content.
async function summarise(
  ctx: RouteContext,
  projectId: ProjectId,
  sessionId: SessionId,
): Promise<RetentionSummary> {
  const sets = await listChunkSets({ storeRoot: ctx.storeRoot, projectId, sessionId });
  let totalBytes = 0;
  let oldestAt: string | null = null;
  for (const set of sets) {
    totalBytes += set.rawBytes;
    if (oldestAt === null || set.createdAt < oldestAt) oldestAt = set.createdAt;
  }
  return { chunkSets: sets.length, totalBytes, oldestAt };
}

export async function handleRetentionSummary(ctx: RouteContext, idRaw: string): Promise<void> {
  const session = resolveSession(ctx, idRaw);
  if (!session) return;
  try {
    ctx.sendJson(ctx.res, 200, await summarise(ctx, session.projectId, session.id), ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleRetentionClear(ctx: RouteContext, idRaw: string): Promise<void> {
  const session = resolveSession(ctx, idRaw);
  if (!session) return;
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = CLEAR_RETENTION_BODY.safeParse(body);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      zodErrorMessage(parsed.error),
      ctx.origin,
      parsed.error.issues,
    );
    return;
  }
  try {
    const { projectId, id: sessionId } = session;
    const sets = await listChunkSets({ storeRoot: ctx.storeRoot, projectId, sessionId });
    for (const set of sets) {
      await deleteChunkSet({
        storeRoot: ctx.storeRoot,
        projectId,
        sessionId,
        chunkSetId: set.chunkSetId,
      });
    }
    // Re-summarise post-delete; the count is now 0 (the contract the GUI shows).
    ctx.sendJson(ctx.res, 200, await summarise(ctx, projectId, sessionId), ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleRetentionPrune(ctx: RouteContext, idRaw: string): Promise<void> {
  const session = resolveSession(ctx, idRaw);
  if (!session) return;
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = PRUNE_RETENTION_BODY.safeParse(body);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      zodErrorMessage(parsed.error),
      ctx.origin,
      parsed.error.issues,
    );
    return;
  }
  try {
    const { projectId, id: sessionId } = session;
    // Session-scoped prune: content-store.pruneOlderThan walks the whole store,
    // so we filter THIS session's sets ourselves to honour the never-wider rule.
    const cutoff = new Date(Date.parse(ctx.now()) - parsed.data.days * 86_400_000);
    const sets = await listChunkSets({ storeRoot: ctx.storeRoot, projectId, sessionId });
    let removed = 0;
    for (const set of sets) {
      if (new Date(set.createdAt) < cutoff) {
        await deleteChunkSet({
          storeRoot: ctx.storeRoot,
          projectId,
          sessionId,
          chunkSetId: set.chunkSetId,
        });
        removed += 1;
      }
    }
    const summary = await summarise(ctx, projectId, sessionId);
    ctx.sendJson(ctx.res, 200, { removed, ...summary }, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

const RETENTION_PATH = /^\/api\/sessions\/([^/]+)\/retention(?:\/(clear|prune))?$/;

export async function dispatchRetention(
  ctx: RouteContext,
  method: string,
  path: string,
  onMethodNotAllowed: () => void,
): Promise<boolean> {
  const match = path.match(RETENTION_PATH);
  if (!match) return false;
  const idRaw = match[1] as string;
  const segment = match[2];

  const guard = (expected: string): boolean => {
    if (method === expected) return true;
    onMethodNotAllowed();
    return false;
  };

  if (segment === undefined) {
    if (guard("GET")) await handleRetentionSummary(ctx, idRaw);
    return true;
  }
  if (segment === "clear") {
    if (guard("POST")) await handleRetentionClear(ctx, idRaw);
    return true;
  }
  if (segment === "prune") {
    if (guard("POST")) await handleRetentionPrune(ctx, idRaw);
    return true;
  }
  return false;
}
