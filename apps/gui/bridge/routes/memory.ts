import {
  type CoreRegistry,
  type MemoryEntry,
  type Session,
  memoryEntrySchema,
} from "@megasaver/core";
import { type SessionId, projectIdSchema } from "@megasaver/shared";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { CREATE_MEMORY_BODY, zodErrorMessage } from "../zod-schemas.js";
import { readJsonBody } from "./_body.js";

function ensureProject(registry: CoreRegistry, projectId: string): boolean {
  return registry.getProject(projectId as Parameters<CoreRegistry["getProject"]>[0]) !== null;
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
    entries = entries.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    ctx.sendJson(ctx.res, 200, entries, ctx.origin);
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
  // so we can surface session_already_ended distinctly. Core only emits
  // session_project_mismatch and session_not_found from createMemoryEntry.
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
    const entry = memoryEntrySchema.parse({
      id: entryId,
      projectId: parsed.data.projectId,
      sessionId: resolvedSessionId,
      scope: parsed.data.scope,
      content: parsed.data.content,
      createdAt: ctx.now(),
    });
    const created = ctx.registry.createMemoryEntry(entry);
    ctx.sendJson(ctx.res, 201, created, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
