import type { RouteContext } from "../route-context.js";
import { readJsonBody } from "./_body.js";

export async function handleGetForgeFailures(ctx: RouteContext): Promise<void> {
  ctx.sendJson(
    ctx.res,
    200,
    {
      failures: [
        {
          id: "fail-01",
          pattern: "Unchecked array index dereference in tool output",
          occurrences: 3,
          ruleCreated: false,
        },
      ],
    },
    ctx.origin,
  );
}

export async function handlePostForgeLearn(ctx: RouteContext): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const payload = body as { failureId?: string; ruleTitle?: string };
  ctx.sendJson(
    ctx.res,
    200,
    {
      learned: true,
      ruleId: `rule-${payload.failureId ?? "new"}`,
      ruleTitle: payload.ruleTitle ?? "Always verify non-null state before dereferencing array indices.",
    },
    ctx.origin,
  );
}

export async function handleGetFirewallStatus(ctx: RouteContext): Promise<void> {
  ctx.sendJson(
    ctx.res,
    200,
    {
      enabled: true,
      activeRules: 12,
      blockedAttempts: 5,
    },
    ctx.origin,
  );
}
