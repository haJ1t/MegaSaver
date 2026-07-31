import type { RouteContext } from "../route-context.js";
import { readJsonBody } from "./_body.js";

let storedBudget = {
  monthlyBudgetTokens: 5000000,
  spentTokens: 1250000,
  pacePercent: 25,
  isOverBudget: false,
};

export async function handleGetRoi(ctx: RouteContext): Promise<void> {
  ctx.sendJson(
    ctx.res,
    200,
    {
      savedDollars: 142.5,
      timeSavedHours: 18.2,
      roiRatio: 9.5,
      projectedAnnualSavings: 1710,
    },
    ctx.origin,
  );
}

export async function handleGetBudget(ctx: RouteContext): Promise<void> {
  ctx.sendJson(ctx.res, 200, storedBudget, ctx.origin);
}

export async function handlePostBudget(ctx: RouteContext): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const payload = body as { monthlyBudgetTokens?: number };
  if (typeof payload.monthlyBudgetTokens === "number") {
    storedBudget.monthlyBudgetTokens = payload.monthlyBudgetTokens;
    storedBudget.pacePercent = Math.round(
      (storedBudget.spentTokens / storedBudget.monthlyBudgetTokens) * 100,
    );
    storedBudget.isOverBudget = storedBudget.spentTokens > storedBudget.monthlyBudgetTokens;
  }
  ctx.sendJson(ctx.res, 200, storedBudget, ctx.origin);
}

export async function handleDeleteBudget(ctx: RouteContext): Promise<void> {
  storedBudget = {
    monthlyBudgetTokens: 0,
    spentTokens: 1250000,
    pacePercent: 0,
    isOverBudget: false,
  };
  ctx.sendJson(ctx.res, 200, storedBudget, ctx.origin);
}

export async function handleGetAlerts(ctx: RouteContext): Promise<void> {
  ctx.sendJson(
    ctx.res,
    200,
    {
      spikes: [],
      firewallAlerts: [],
    },
    ctx.origin,
  );
}

export async function handleGetBenchReport(ctx: RouteContext): Promise<void> {
  ctx.sendJson(
    ctx.res,
    200,
    {
      benchmarkName: "ContextOps Standard Suite",
      savingsPercentage: 88.4,
      latencyMs: 145,
      geomeanMultiplier: 1.35,
    },
    ctx.origin,
  );
}
