import type { RouteContext } from "../route-context.js";
import { readJsonBody } from "./_body.js";

// Budget persists via @megasaver/stats/budget (atomicWriteFile 0600/0700/fsync/no-symlink).
// ROI + savings use the same pricing invariant as the CLI: MODEL_LIST_PRICES
// captured 2026-08-01, isEstimate:true, SAVINGS_FOOTNOTE — single source.

type StoredBudgetWire = {
  version: 1;
  period: "month" | "week";
  kind: "tokens" | "dollars";
  amount: number;
};

export type RoiResponseWire = {
  savedDollars: number;
  timeSavedHours: number;
  roiRatio: number;
  projectedAnnualSavings: number;
  isEstimate: true;
  footnote: string;
  capturedAt: string;
  inputPricePerMTokUsd: number;
};

function toMonthlyTokens(b: { kind: string; period: string; amount: number }): number | null {
  // Stats budget is polymorphic (tokens|dollars × month|week). The GUI budget is
  // a monthly TOKEN limit, so only tokens/month maps 1:1. Others expose the raw
  // budget via the same field so the card never invents a conversion.
  if (b.kind === "tokens" && b.period === "month") return Math.round(b.amount);
  return null;
}

export async function handleGetRoi(ctx: RouteContext): Promise<void> {
  try {
    const { readAllWorkspaceTokenSaverTotals } = await import("@megasaver/stats");
    const {
      computeSavingsHeadline,
      SAVINGS_FOOTNOTE,
      INPUT_PRICE_PER_MTOK_USD,
      INPUT_PRICE_CAPTURED_AT,
    } = await import("@megasaver/stats");
    const totals = readAllWorkspaceTokenSaverTotals({ root: ctx.storeRoot });
    const headline = computeSavingsHeadline(totals);
    // Time model: ~600 tokens/s sustained reading (≈2.16M/h). ROI: saved/actual.
    // Investment baseline is priced at the same INPUT_PRICE so the ratio is
    // price-invariant. Projected annual = 12× current (simple). These match
    // the CLI headlined numbers when fed the same totals.
    const TOKENS_PER_HOUR = 2_160_000;
    const timeSavedHours = headline.tokensSaved / TOKENS_PER_HOUR;
    const actualTokens = Math.max(0, headline.grossTokensSaved - headline.tokensSaved);
    const baselineCost = (actualTokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD;
    const roiRatio = baselineCost === 0 ? 0 : headline.dollarsSaved / baselineCost;
    const projectedAnnualSavings = headline.dollarsSaved * 12;
    const body: RoiResponseWire = {
      savedDollars: headline.dollarsSaved,
      timeSavedHours,
      roiRatio,
      projectedAnnualSavings,
      isEstimate: true,
      footnote: SAVINGS_FOOTNOTE,
      capturedAt: INPUT_PRICE_CAPTURED_AT,
      inputPricePerMTokUsd: INPUT_PRICE_PER_MTOK_USD,
    };
    ctx.sendJson(ctx.res, 200, body, ctx.origin);
  } catch {
    // Tolerant: a torn store never 500s. Read returns zeros → headline dollars 0.
    // Only a bizarre import failure lands here — degrade to zeros, still honest.
    const { SAVINGS_FOOTNOTE, INPUT_PRICE_PER_MTOK_USD, INPUT_PRICE_CAPTURED_AT } = await import(
      "@megasaver/stats"
    );
    ctx.sendJson(
      ctx.res,
      200,
      {
        savedDollars: 0,
        timeSavedHours: 0,
        roiRatio: 0,
        projectedAnnualSavings: 0,
        isEstimate: true,
        footnote: SAVINGS_FOOTNOTE,
        capturedAt: INPUT_PRICE_CAPTURED_AT,
        inputPricePerMTokUsd: INPUT_PRICE_PER_MTOK_USD,
      } satisfies RoiResponseWire,
      ctx.origin,
    );
  }
}

export async function handleGetBudget(ctx: RouteContext): Promise<void> {
  try {
    const { readBudget, budgetStatus } = await import("@megasaver/stats");
    const { readAllWorkspaceTokenSaverTotals } = await import("@megasaver/stats");
    const { tokensFromBytes } = await import("@megasaver/stats");
    const stored = readBudget(ctx.storeRoot);
    const totals = readAllWorkspaceTokenSaverTotals({ root: ctx.storeRoot });
    const spentTokens = tokensFromBytes(totals.deltaBytesTotal ?? totals.bytesSavedTotal);
    if (stored === null) {
      let status: "absent" | "corrupt" | "ok" = "absent";
      try {
        const s = budgetStatus(ctx.storeRoot);
        status = s === "ok" ? "absent" : s;
      } catch {
        status = "absent";
      }
      ctx.sendJson(
        ctx.res,
        200,
        {
          monthlyBudgetTokens: 0,
          spentTokens,
          pacePercent: 0,
          isOverBudget: false,
          status,
        },
        ctx.origin,
      );
      return;
    }
    const monthlyBudgetTokens = toMonthlyTokens(stored) ?? 0;
    const pacePercent =
      monthlyBudgetTokens === 0 ? 0 : Math.round((spentTokens / monthlyBudgetTokens) * 100);
    ctx.sendJson(
      ctx.res,
      200,
      {
        monthlyBudgetTokens,
        spentTokens,
        pacePercent,
        isOverBudget: monthlyBudgetTokens > 0 && spentTokens > monthlyBudgetTokens,
        status: "ok",
        raw: stored,
      },
      ctx.origin,
    );
  } catch {
    // Corrupt budget file is distinct from absent (budgetStatus contract) — never 500.
    const { budgetStatus, tokensFromBytes, readAllWorkspaceTokenSaverTotals } = await import(
      "@megasaver/stats"
    );
    let spentTokens = 0;
    try {
      const t = readAllWorkspaceTokenSaverTotals({ root: ctx.storeRoot });
      spentTokens = tokensFromBytes(t.deltaBytesTotal ?? t.bytesSavedTotal);
    } catch {}
    const st = (() => {
      try {
        return budgetStatus(ctx.storeRoot);
      } catch {
        return "corrupt" as const;
      }
    })();
    ctx.sendJson(
      ctx.res,
      200,
      {
        monthlyBudgetTokens: 0,
        spentTokens,
        pacePercent: 0,
        isOverBudget: false,
        status: st,
      },
      ctx.origin,
    );
  }
}

export async function handlePostBudget(ctx: RouteContext): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const payload = body as { monthlyBudgetTokens?: unknown };
  const amt = payload.monthlyBudgetTokens;
  if (typeof amt !== "number" || !Number.isFinite(amt) || amt <= 0) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      "monthlyBudgetTokens must be a positive number.",
      ctx.origin,
    );
    return;
  }
  const rounded = Math.round(amt);
  try {
    const { writeBudget } = await import("@megasaver/stats");
    const { readAllWorkspaceTokenSaverTotals, tokensFromBytes } = await import("@megasaver/stats");
    writeBudget(ctx.storeRoot, {
      version: 1,
      period: "month",
      kind: "tokens",
      amount: rounded,
    });
    const totals = readAllWorkspaceTokenSaverTotals({ root: ctx.storeRoot });
    const spentTokens = tokensFromBytes(totals.deltaBytesTotal ?? totals.bytesSavedTotal);
    ctx.sendJson(
      ctx.res,
      200,
      {
        monthlyBudgetTokens: rounded,
        spentTokens,
        pacePercent: Math.round((spentTokens / rounded) * 100),
        isOverBudget: spentTokens > rounded,
        status: "ok",
      },
      ctx.origin,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to write budget.";
    ctx.sendError(ctx.res, 500, "internal_error", msg, ctx.origin);
  }
}

export async function handleDeleteBudget(ctx: RouteContext): Promise<void> {
  try {
    const { clearBudget, readAllWorkspaceTokenSaverTotals, tokensFromBytes } = await import(
      "@megasaver/stats"
    );
    clearBudget(ctx.storeRoot);
    let spentTokens = 0;
    try {
      const t = readAllWorkspaceTokenSaverTotals({ root: ctx.storeRoot });
      spentTokens = tokensFromBytes(t.deltaBytesTotal ?? t.bytesSavedTotal);
    } catch {}
    ctx.sendJson(
      ctx.res,
      200,
      {
        monthlyBudgetTokens: 0,
        spentTokens,
        pacePercent: 0,
        isOverBudget: false,
        status: "absent",
      },
      ctx.origin,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to clear budget.";
    ctx.sendError(ctx.res, 500, "internal_error", msg, ctx.origin);
  }
}

export async function handleGetAlerts(ctx: RouteContext): Promise<void> {
  // No fabricated data: until a real detector exists the honest response is empty
  // (dashboard hides the section). Returning [] with hasData:false is not a lie;
  // a fixed 88.4% benchmark was.
  ctx.sendJson(ctx.res, 200, { hasData: false, spikes: [], firewallAlerts: [] }, ctx.origin);
}

export async function handleGetBenchReport(ctx: RouteContext): Promise<void> {
  ctx.sendJson(
    ctx.res,
    200,
    { hasData: false, benchmarkName: "ContextOps Standard Suite", savingsPercentage: null },
    ctx.origin,
  );
}
