import { tokensFromBytes } from "./honest-metrics.js";

// Stage A / P0 (spec 2026-07-19-net-positive-megasaver-design.md): estimate
// whether the saver is net-positive per workspace. Pure — callers do all I/O.
//
// churn model: proxied requests with messageCount >= 3 are continuation turns;
// their cache_creation should sit near the append median. Anything above the
// median is "excess" — the churn signature the saver can cause. Excess is
// attributed to workspaces by their share of compressions in the window,
// because the ledger rows themselves carry no workspace key.

export type ProxyUsageRow = {
  ts: string;
  cacheCreationTokens: number;
  messageCount: number;
};

export type WorkspaceWindowStats = {
  workspaceKey: string;
  savedBytesInWindow: number;
  compressionsInWindow: number;
};

export type NetEffectVerdict = {
  workspaceKey: string;
  savedTokens: number;
  churnTokens: number;
  verdict: "ok" | "negative" | "unknown";
};

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_CONTINUATION_ROWS = 20;

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  // biome-ignore lint/style/noNonNullAssertion: length checked by callers
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function estimateNetEffect(input: {
  nowIso: string;
  workspaces: readonly WorkspaceWindowStats[];
  usageRows: readonly ProxyUsageRow[];
}): NetEffectVerdict[] {
  const since = Date.parse(input.nowIso) - WINDOW_MS;
  const continuation = input.usageRows.filter((r) => {
    const t = Date.parse(r.ts);
    return Number.isFinite(t) && t >= since && r.messageCount >= 3;
  });

  const totalCompressions = input.workspaces.reduce((n, w) => n + w.compressionsInWindow, 0);

  let excess = 0;
  if (continuation.length >= MIN_CONTINUATION_ROWS) {
    const med = median(continuation.map((r) => r.cacheCreationTokens).sort((a, b) => a - b));
    for (const r of continuation) excess += Math.max(0, r.cacheCreationTokens - med);
  }

  return input.workspaces.map((w) => {
    const savedTokens = tokensFromBytes(Math.max(0, w.savedBytesInWindow));
    if (
      continuation.length < MIN_CONTINUATION_ROWS ||
      w.compressionsInWindow === 0 ||
      totalCompressions === 0
    ) {
      return { workspaceKey: w.workspaceKey, savedTokens, churnTokens: 0, verdict: "unknown" };
    }
    const churnTokens = Math.round(excess * (w.compressionsInWindow / totalCompressions));
    return {
      workspaceKey: w.workspaceKey,
      savedTokens,
      churnTokens,
      verdict: savedTokens - churnTokens < 0 ? "negative" : "ok",
    };
  });
}
