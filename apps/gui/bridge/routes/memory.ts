import {
  type CoreRegistry,
  type MemoryEntry,
  type MemoryEntryUpdatePatch,
  type Session,
  memoryEntrySchema,
} from "@megasaver/core";
import { type SessionId, memoryEntryIdSchema, projectIdSchema } from "@megasaver/shared";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { CREATE_MEMORY_BODY, MEMORY_PATCH_BODY, zodErrorMessage } from "../zod-schemas.js";
import { readJsonBody } from "./_body.js";
import { intParam } from "./_query.js";

function ensureProject(registry: CoreRegistry, projectId: string): boolean {
  return registry.getProject(projectId as Parameters<CoreRegistry["getProject"]>[0]) !== null;
}

// Free-text filter over the human-readable memory fields. Case-insensitive
// substring — cheap, deterministic, and enough for the GUI list search (§5).
function matchesQuery(entry: MemoryEntry, query: string): boolean {
  const q = query.toLowerCase();
  return (
    entry.content.toLowerCase().includes(q) ||
    entry.title.toLowerCase().includes(q) ||
    entry.keywords.some((k) => k.toLowerCase().includes(q))
  );
}

export function handleGetMemory(ctx: RouteContext): void {
  try {
    const projectIdRaw = ctx.query.get("projectId");
    let entries: MemoryEntry[];
    if (projectIdRaw === null) {
      entries = ctx.registry
        .listProjects()
        .flatMap((project) => ctx.registry.listMemoryEntries(project.id));
    } else {
      const parsed = projectIdSchema.safeParse(projectIdRaw);
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
      if (!ensureProject(ctx.registry, parsed.data)) {
        ctx.sendError(
          ctx.res,
          404,
          "project_not_found",
          `Project not found: ${parsed.data}`,
          ctx.origin,
        );
        return;
      }
      entries = ctx.registry.listMemoryEntries(parsed.data);
    }
    const query = ctx.query.get("query");
    if (query !== null && query.trim().length > 0) {
      entries = entries.filter((e) => matchesQuery(e, query.trim()));
    }
    entries = entries.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = intParam(ctx.query.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(ctx.query.get("limit"), entries.length, 1, 500);
    ctx.sendJson(ctx.res, 200, entries.slice(offset, offset + limit), ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handlePostMemory(ctx: RouteContext): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = CREATE_MEMORY_BODY.safeParse(body);
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
  if (!ensureProject(ctx.registry, parsed.data.projectId)) {
    ctx.sendError(
      ctx.res,
      404,
      "project_not_found",
      `Project not found: ${parsed.data.projectId}`,
      ctx.origin,
    );
    return;
  }
  // Pre-flight: session must exist and be open before delegating to Core,
  // so we can surface session_already_ended distinctly.
  let resolvedSessionId: SessionId | null = null;
  if (parsed.data.scope === "session" && parsed.data.sessionId !== undefined) {
    const session: Session | null = ctx.registry.getSession(parsed.data.sessionId);
    if (!session) {
      ctx.sendError(
        ctx.res,
        404,
        "session_not_found",
        `Session not found: ${parsed.data.sessionId}`,
        ctx.origin,
      );
      return;
    }
    if (session.endedAt !== null) {
      ctx.sendError(
        ctx.res,
        409,
        "session_already_ended",
        `Session already ended: ${parsed.data.sessionId}`,
        ctx.origin,
      );
      return;
    }
    resolvedSessionId = parsed.data.sessionId;
  }
  try {
    const entryId = ctx.newId();
    const createdAt = ctx.now();
    // Typed-memory surface (§3c): honour caller-supplied typed fields, fall back
    // to neutral Phase-1 defaults when omitted. Optional fields are spread in
    // only when present so memoryEntrySchema's optionals stay absent (not null).
    const entry = memoryEntrySchema.parse({
      id: entryId,
      projectId: parsed.data.projectId,
      sessionId: resolvedSessionId,
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
    const created = ctx.registry.createMemoryEntry(entry);
    ctx.sendJson(ctx.res, 201, created, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handlePatchMemory(ctx: RouteContext, idRaw: string): Promise<void> {
  const idParse = memoryEntryIdSchema.safeParse(idRaw);
  if (!idParse.success) {
    ctx.sendError(
      ctx.res,
      404,
      "memory_entry_not_found",
      `Memory entry not found: ${idRaw}`,
      ctx.origin,
    );
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
    const patch = { ...parsed.data, updatedAt: ctx.now() } as MemoryEntryUpdatePatch;
    const updated = ctx.registry.updateMemoryEntry(idParse.data, patch);
    ctx.sendJson(ctx.res, 200, updated, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleDeleteMemory(ctx: RouteContext, idRaw: string): Promise<void> {
  const idParse = memoryEntryIdSchema.safeParse(idRaw);
  if (!idParse.success) {
    ctx.sendError(
      ctx.res,
      404,
      "memory_entry_not_found",
      `Memory entry not found: ${idRaw}`,
      ctx.origin,
    );
    return;
  }
  try {
    ctx.registry.deleteMemoryEntry(idParse.data);
    ctx.sendJson(ctx.res, 200, { id: idParse.data }, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
