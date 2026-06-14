import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentStoreError, loadOverlayChunkSet } from "@megasaver/content-store";
import { type TokenSaverSettings, tokenSaverSettingsSchema } from "@megasaver/core";
import { type StatsStore, readOverlayEvents, readOverlaySummary } from "@megasaver/stats";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
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
  /^\/api\/claude-sessions\/([^/]+)\/([^/]+?)\/token-saver(?:\/(status|stats|events)(?:\/([^/]+)\/(raw|sent))?)?$/;

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
