import { readAuditEvents, resolveAuditWindow, summarizeAudit } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { auditWindowSchema } from "@megasaver/stats";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { zodErrorMessage } from "../zod-schemas.js";
import { resolveProject } from "./_project.js";

export function handleGetAudit(ctx: RouteContext, projectIdRaw: string): void {
  const project = resolveProject(ctx, projectIdRaw);
  if (!project) return;
  const windowRaw = ctx.query.get("window");
  let window: ReturnType<typeof auditWindowSchema.parse> | undefined;
  if (windowRaw !== null) {
    const parsed = auditWindowSchema.safeParse(windowRaw);
    if (!parsed.success) {
      ctx.sendError(
        ctx.res,
        400,
        "validation_failed",
        `Invalid window "${windowRaw}" (session | week | all).`,
        ctx.origin,
      );
      return;
    }
    window = parsed.data;
  }
  const sessionRaw = ctx.query.get("session");
  let sessionId: ReturnType<typeof sessionIdSchema.parse> | undefined;
  if (sessionRaw !== null) {
    const parsed = sessionIdSchema.safeParse(sessionRaw);
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
    sessionId = parsed.data;
  }
  try {
    const events = readAuditEvents({ root: ctx.storeRoot }, project.id, sessionId);
    const resolvedWindow = resolveAuditWindow(window, sessionId !== undefined);
    const summary = summarizeAudit(events, { window: resolvedWindow, now: ctx.now });
    ctx.sendJson(ctx.res, 200, summary, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
