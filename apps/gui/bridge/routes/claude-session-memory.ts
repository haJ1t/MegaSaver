import {
  type OverlayMemoryEntry,
  overlayMemoryEntrySchema,
  readOverlayMemory,
  writeOverlayMemory,
} from "@megasaver/core";
import { memoryEntryIdSchema } from "@megasaver/shared";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { CREATE_LIVE_MEMORY_BODY, MEMORY_PATCH_BODY, zodErrorMessage } from "../zod-schemas.js";
import { readJsonBody } from "./_body.js";
import { resolveSessionWorkspace, sendSessionResolveError } from "./_claude-session.js";

function matchesQuery(entry: OverlayMemoryEntry, query: string): boolean {
  const q = query.toLowerCase();
  return (
    entry.content.toLowerCase().includes(q) ||
    entry.title.toLowerCase().includes(q) ||
    entry.keywords.some((k) => k.toLowerCase().includes(q))
  );
}

export async function handleGetSessionMemory(
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
    let rows = readOverlayMemory(ctx.storeRoot, resolved.workspaceKey);
    const scope = ctx.query.get("scope");
    if (scope === "session") {
      rows = rows.filter(
        (r) => r.scope === "session" && r.liveSessionId === resolved.liveSessionId,
      );
    } else if (scope === "project") {
      rows = rows.filter((r) => r.scope === "project");
    }
    const query = ctx.query.get("query");
    if (query !== null && query.trim().length > 0) {
      rows = rows.filter((r) => matchesQuery(r, query.trim()));
    }
    rows = rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    ctx.sendJson(ctx.res, 200, rows, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handlePostSessionMemory(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const resolved = await resolveSessionWorkspace(ctx, dir, id);
  if (resolved === "unsafe" || resolved === "not_found") {
    sendSessionResolveError(ctx, resolved, dir, id);
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = CREATE_LIVE_MEMORY_BODY.safeParse(body);
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
    const createdAt = ctx.now();
    const entry = overlayMemoryEntrySchema.parse({
      id: ctx.newId(),
      workspaceKey: resolved.workspaceKey,
      liveSessionId: parsed.data.scope === "session" ? resolved.liveSessionId : null,
      scope: parsed.data.scope,
      type: parsed.data.type ?? "todo",
      title: parsed.data.title ?? parsed.data.content,
      content: parsed.data.content,
      keywords: parsed.data.keywords ?? [],
      confidence: parsed.data.confidence ?? "medium",
      source: parsed.data.source ?? "manual",
      createdAt,
      updatedAt: createdAt,
      ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
      ...(parsed.data.goal !== undefined ? { goal: parsed.data.goal } : {}),
      ...(parsed.data.expiresAt !== undefined ? { expiresAt: parsed.data.expiresAt } : {}),
    });
    const rows = readOverlayMemory(ctx.storeRoot, resolved.workspaceKey);
    writeOverlayMemory(ctx.storeRoot, resolved.workspaceKey, [...rows, entry]);
    ctx.sendJson(ctx.res, 201, entry, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handlePatchSessionMemory(
  ctx: RouteContext,
  dir: string,
  id: string,
  entryId: string,
): Promise<void> {
  const idParse = memoryEntryIdSchema.safeParse(entryId);
  if (!idParse.success) {
    ctx.sendError(
      ctx.res,
      404,
      "memory_entry_not_found",
      `Memory entry not found: ${entryId}`,
      ctx.origin,
    );
    return;
  }
  const resolved = await resolveSessionWorkspace(ctx, dir, id);
  if (resolved === "unsafe" || resolved === "not_found") {
    sendSessionResolveError(ctx, resolved, dir, id);
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = MEMORY_PATCH_BODY.safeParse(body);
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
    const rows = readOverlayMemory(ctx.storeRoot, resolved.workspaceKey);
    const index = rows.findIndex((r) => r.id === idParse.data);
    if (index === -1) {
      ctx.sendError(
        ctx.res,
        404,
        "memory_entry_not_found",
        `Memory entry not found: ${entryId}`,
        ctx.origin,
      );
      return;
    }
    const prior = rows[index] as OverlayMemoryEntry;
    const updated = overlayMemoryEntrySchema.parse({
      ...prior,
      ...parsed.data,
      updatedAt: ctx.now(),
    });
    const next = rows.slice();
    next[index] = updated;
    writeOverlayMemory(ctx.storeRoot, resolved.workspaceKey, next);
    ctx.sendJson(ctx.res, 200, updated, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleDeleteSessionMemory(
  ctx: RouteContext,
  dir: string,
  id: string,
  entryId: string,
): Promise<void> {
  const idParse = memoryEntryIdSchema.safeParse(entryId);
  if (!idParse.success) {
    ctx.sendError(
      ctx.res,
      404,
      "memory_entry_not_found",
      `Memory entry not found: ${entryId}`,
      ctx.origin,
    );
    return;
  }
  const resolved = await resolveSessionWorkspace(ctx, dir, id);
  if (resolved === "unsafe" || resolved === "not_found") {
    sendSessionResolveError(ctx, resolved, dir, id);
    return;
  }
  try {
    const rows = readOverlayMemory(ctx.storeRoot, resolved.workspaceKey);
    const next = rows.filter((r) => r.id !== idParse.data);
    if (next.length === rows.length) {
      ctx.sendError(
        ctx.res,
        404,
        "memory_entry_not_found",
        `Memory entry not found: ${entryId}`,
        ctx.origin,
      );
      return;
    }
    writeOverlayMemory(ctx.storeRoot, resolved.workspaceKey, next);
    ctx.sendJson(ctx.res, 200, { id: idParse.data }, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
