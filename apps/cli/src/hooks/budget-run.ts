import {
  type BudgetAnnouncements,
  type TokenBudgetState,
  effectiveSessionBudget,
  evaluateBudget,
  foldMeasuredBurn,
  readOverlayEvents,
  readTokenBudgetState,
  readTokenBudgets,
  tokenBudgetsStatus,
  writeTokenBudgetState,
} from "@megasaver/core";

export const BUDGET_HISTORY_SESSION_CAP = 20;
const NO_ANNOUNCEMENTS: BudgetAnnouncements = {
  warn80: false,
  warn100: false,
  variance: false,
};

// HOT PATH: one synchronous small-file read (same cost class as
// readSessionIntent). Never throws, never awaits, never writes.
export function maybeReadBudgetWarning(
  storeRoot: string,
  workspaceKey: string,
  liveSessionId: string,
): string | undefined {
  try {
    const state = readTokenBudgetState(storeRoot, workspaceKey, liveSessionId);
    if (state === null || state.pendingLines.length === 0) return undefined;
    return state.pendingLines.join("\n");
  } catch {
    return undefined;
  }
}

// DEFERRED (post-stdout, the maybeRunOverlayGc slot): folds receipts and
// rewrites the state file. Sync on purpose — zero awaited I/O anywhere.
export function refreshBudgetState(input: {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
  now?: () => string;
}): void {
  try {
    const { storeRoot, workspaceKey, liveSessionId } = input;
    if (tokenBudgetsStatus(storeRoot, workspaceKey) !== "ok") return; // absent OR corrupt: fail-open
    const budgets = readTokenBudgets(storeRoot, workspaceKey);
    if (budgets === null) return;
    const store = { root: storeRoot };
    const burn = foldMeasuredBurn(readOverlayEvents(store, workspaceKey, liveSessionId));
    const limit = effectiveSessionBudget(budgets, liveSessionId);
    const label = budgets.labels[liveSessionId];
    // Spec Locked #5: "historical" samples are approximated as any OTHER
    // labeled session with >= 1 measured event — no completion marker
    // exists, so in-flight siblings may deflate the median (advisory noise).
    const siblings =
      label === undefined
        ? []
        : Object.entries(budgets.labels)
            .filter(([sid, l]) => l === label && sid !== liveSessionId)
            .slice(-BUDGET_HISTORY_SESSION_CAP)
            .map(([sid]) => foldMeasuredBurn(readOverlayEvents(store, workspaceKey, sid)))
            .filter((b) => b.measuredEvents > 0)
            .map((b) => b.burnTokens);
    const prior = readTokenBudgetState(storeRoot, workspaceKey, liveSessionId);
    const announced = prior?.announced ?? NO_ANNOUNCEMENTS;
    const result = evaluateBudget({
      burn,
      limit,
      historicalBurns: siblings,
      announced,
    });
    const state: TokenBudgetState = {
      version: 1,
      burnTokens: burn.burnTokens,
      measuredEvents: burn.measuredEvents,
      unmeasuredEvents: burn.unmeasuredEvents,
      announced: result.announced,
      pendingLines: [...result.lines].slice(0, 8),
      updatedAt: (input.now ?? (() => new Date().toISOString()))(),
    };
    writeTokenBudgetState(storeRoot, workspaceKey, liveSessionId, state);
  } catch {
    /* best-effort; a budget failure must never surface in the hook */
  }
}
