import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentStoreError, loadChunkSet } from "@megasaver/content-store";
import { type Session, type TokenSaverSettings, defaultTokenSaverSettings } from "@megasaver/core";
import { type ProjectId, type SessionId, sessionIdSchema } from "@megasaver/shared";
import {
  type SessionTokenSaverStats,
  type StatsStore,
  type TokenSaverEvent,
  readSummary,
  resetOnDisable,
  tokenSaverEventSchema,
} from "@megasaver/stats";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import {
  DISABLE_TOKEN_SAVER_BODY,
  ENABLE_TOKEN_SAVER_BODY,
  zodErrorMessage,
} from "../zod-schemas.js";
import { readJsonBody } from "./_body.js";

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

function statsStore(ctx: RouteContext): StatsStore {
  return { root: ctx.storeRoot };
}

// Reads the append-only JSONL stats log directly (epic §13b). The stats
// package exposes no per-event reader; the bridge is a consumer of the
// fixed on-disk format. A trailing partial line (crash mid-append) is
// tolerated only as the final line.
function readEvents(
  ctx: RouteContext,
  projectId: ProjectId,
  sessionId: SessionId,
): TokenSaverEvent[] {
  const path = join(ctx.storeRoot, "stats", projectId, `${sessionId}.events.jsonl`);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n");
  const events: TokenSaverEvent[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      if (i === lines.length - 1) break;
      throw err;
    }
    events.push(tokenSaverEventSchema.parse(parsed));
  }
  return events;
}

export async function handleEnableTokenSaver(ctx: RouteContext, idRaw: string): Promise<void> {
  const session = resolveSession(ctx, idRaw);
  if (!session) return;
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = ENABLE_TOKEN_SAVER_BODY.safeParse(body);
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
    const base = session.tokenSaver ?? defaultTokenSaverSettings(ctx.now);
    const overlay = parsed.data;
    const next: TokenSaverSettings = {
      ...base,
      enabled: true,
      updatedAt: ctx.now(),
    };
    if (overlay.mode !== undefined) next.mode = overlay.mode;
    if (overlay.maxReturnedBytes !== undefined) next.maxReturnedBytes = overlay.maxReturnedBytes;
    if (overlay.storeRawOutput !== undefined) next.storeRawOutput = overlay.storeRawOutput;
    if (overlay.redactSecrets !== undefined) next.redactSecrets = overlay.redactSecrets;
    if (overlay.autoRepair !== undefined) next.autoRepair = overlay.autoRepair;
    const updated = ctx.registry.updateTokenSaver(session.id, next);
    ctx.sendJson(ctx.res, 200, updated, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleDisableTokenSaver(ctx: RouteContext, idRaw: string): Promise<void> {
  const session = resolveSession(ctx, idRaw);
  if (!session) return;
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = DISABLE_TOKEN_SAVER_BODY.safeParse(body);
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
    let result = session;
    if (session.tokenSaver !== undefined) {
      result = ctx.registry.updateTokenSaver(session.id, {
        ...session.tokenSaver,
        enabled: false,
        updatedAt: ctx.now(),
      });
    }
    resetOnDisable(statsStore(ctx), session.projectId, session.id);
    ctx.sendJson(ctx.res, 200, result, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export function handleTokenSaverStatus(ctx: RouteContext, idRaw: string): void {
  const session = resolveSession(ctx, idRaw);
  if (!session) return;
  const settings = session.tokenSaver ?? null;
  ctx.sendJson(ctx.res, 200, { enabled: settings?.enabled === true, settings }, ctx.origin);
}

export function handleTokenSaverStats(ctx: RouteContext, idRaw: string): void {
  const session = resolveSession(ctx, idRaw);
  if (!session) return;
  try {
    const summary: SessionTokenSaverStats | null = readSummary(
      statsStore(ctx),
      session.projectId,
      session.id,
    );
    ctx.sendJson(ctx.res, 200, summary, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export function handleTokenSaverEvents(ctx: RouteContext, idRaw: string): void {
  const session = resolveSession(ctx, idRaw);
  if (!session) return;
  try {
    const events = readEvents(ctx, session.projectId, session.id);
    events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    ctx.sendJson(ctx.res, 200, events, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

async function serveEventBlob(ctx: RouteContext, idRaw: string, eventId: string): Promise<void> {
  const session = resolveSession(ctx, idRaw);
  if (!session) return;
  try {
    const events = readEvents(ctx, session.projectId, session.id);
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
    let chunkSet: Awaited<ReturnType<typeof loadChunkSet>>;
    try {
      chunkSet = await loadChunkSet({
        storeRoot: ctx.storeRoot,
        projectId: session.projectId,
        sessionId: session.id,
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

export async function handleTokenSaverEventRaw(
  ctx: RouteContext,
  idRaw: string,
  eventId: string,
): Promise<void> {
  await serveEventBlob(ctx, idRaw, eventId);
}

export async function handleTokenSaverEventSent(
  ctx: RouteContext,
  idRaw: string,
  eventId: string,
): Promise<void> {
  await serveEventBlob(ctx, idRaw, eventId);
}

const TOKEN_SAVER_PATH =
  /^\/api\/sessions\/([^/]+)\/token-saver(?:\/(enable|disable|status|stats|events)(?:\/([^/]+)\/(raw|sent))?)?$/;

export async function dispatchTokenSaver(
  ctx: RouteContext,
  method: string,
  path: string,
  onMethodNotAllowed: () => void,
): Promise<boolean> {
  const match = path.match(TOKEN_SAVER_PATH);
  if (!match) return false;
  const idRaw = match[1] as string;
  const segment = match[2];
  const eventId = match[3];
  const blob = match[4];

  const guard = (expected: string): boolean => {
    if (method === expected) return true;
    onMethodNotAllowed();
    return false;
  };

  if (segment === "enable") {
    if (guard("POST")) await handleEnableTokenSaver(ctx, idRaw);
    return true;
  }
  if (segment === "disable") {
    if (guard("POST")) await handleDisableTokenSaver(ctx, idRaw);
    return true;
  }
  if (segment === "status") {
    if (guard("GET")) handleTokenSaverStatus(ctx, idRaw);
    return true;
  }
  if (segment === "stats") {
    if (guard("GET")) handleTokenSaverStats(ctx, idRaw);
    return true;
  }
  if (segment === "events" && eventId === undefined) {
    if (guard("GET")) handleTokenSaverEvents(ctx, idRaw);
    return true;
  }
  if (segment === "events" && eventId !== undefined && blob === "raw") {
    if (guard("GET")) await handleTokenSaverEventRaw(ctx, idRaw, eventId);
    return true;
  }
  if (segment === "events" && eventId !== undefined && blob === "sent") {
    if (guard("GET")) await handleTokenSaverEventSent(ctx, idRaw, eventId);
    return true;
  }
  return false;
}
