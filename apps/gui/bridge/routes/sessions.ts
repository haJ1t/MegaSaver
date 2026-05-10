import type { CoreRegistry, Session } from "@megasaver/core";
import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import {
  CREATE_SESSION_BODY,
  END_SESSION_BODY,
  PATCH_SESSION_BODY,
  zodErrorMessage,
} from "../zod-schemas.js";
import { readJsonBody } from "./_body.js";

function ensureProject(registry: CoreRegistry, projectId: string): boolean {
  return registry.getProject(projectId as Parameters<CoreRegistry["getProject"]>[0]) !== null;
}

export function handleGetSessions(ctx: RouteContext): void {
  try {
    const projectIdRaw = ctx.query.get("projectId");
    let sessions: Session[];
    if (projectIdRaw === null) {
      sessions = ctx.registry
        .listProjects()
        .flatMap((project) => ctx.registry.listSessions(project.id));
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
      sessions = ctx.registry.listSessions(parsed.data);
    }
    sessions = sessions.slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    ctx.sendJson(ctx.res, 200, sessions, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handlePostSession(ctx: RouteContext): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = CREATE_SESSION_BODY.safeParse(body);
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
  try {
    const sessionId = sessionIdSchema.parse(ctx.newId());
    const created = ctx.registry.createSession({
      id: sessionId,
      projectId: parsed.data.projectId,
      agentId: parsed.data.agentId,
      riskLevel: parsed.data.riskLevel,
      title: parsed.data.title ?? null,
      startedAt: ctx.now(),
      endedAt: null,
    });
    ctx.sendJson(ctx.res, 201, created, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleEndSession(ctx: RouteContext, idRaw: string): Promise<void> {
  const idParse = sessionIdSchema.safeParse(idRaw);
  if (!idParse.success) {
    ctx.sendError(ctx.res, 404, "session_not_found", `Session not found: ${idRaw}`, ctx.origin);
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = END_SESSION_BODY.safeParse(body);
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
    const ended = ctx.registry.endSession(idParse.data, {
      endedAt: parsed.data.endedAt ?? ctx.now(),
    });
    ctx.sendJson(ctx.res, 200, ended, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handlePatchSession(ctx: RouteContext, idRaw: string): Promise<void> {
  const idParse = sessionIdSchema.safeParse(idRaw);
  if (!idParse.success) {
    ctx.sendError(ctx.res, 404, "session_not_found", `Session not found: ${idRaw}`, ctx.origin);
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = PATCH_SESSION_BODY.safeParse(body);
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
  const patch: { title?: string | null; riskLevel?: string; agentId?: string } = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.riskLevel !== undefined) patch.riskLevel = parsed.data.riskLevel;
  if (parsed.data.agentId !== undefined) patch.agentId = parsed.data.agentId;
  try {
    const updated = ctx.registry.updateSession(
      idParse.data,
      patch as Parameters<CoreRegistry["updateSession"]>[1],
    );
    ctx.sendJson(ctx.res, 200, updated, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
