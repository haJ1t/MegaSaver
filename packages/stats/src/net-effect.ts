import { tokensFromBytes } from "./honest-metrics.js";

// Stage A / P0 (spec 2026-07-19-net-positive-megasaver-design.md): a per-workspace
// ADVISORY signal. Pure — callers do all I/O.
//
// `excess` sums how far each continuation turn (messageCount >= 3) sits above the
// window median cache_creation. That is a DISPERSION statistic, not a cost or a
// causation statistic: it is positive for any spread distribution, and the same
// total cache_creation redistributed produces a wildly different number. Prompt
// cache TTL expiry, context compaction and user edits all land in the same right
// tail, and the usage ledger carries no workspace key — the tail is split across
// workspaces by compression share. Nothing here shows the saver caused any of it,
// so this must never gate the saver; doctor reports it as unattributed.
//
// A sound gate needs a counterfactual: stamp workspaceKey on proxy usage rows,
// then compare turns the saver rewrote against turns it did not in the same
// workspace and session.

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
  excessTokens: number;
  verdict: "ok" | "negative" | "unknown";
};

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_CONTINUATION_ROWS = 20;
// Only raise the advisory when the excess clearly outweighs measured savings,
// so ordinary one-outlier noise stays quiet.
const ADVISORY_MARGIN = 1.5;

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
      return { workspaceKey: w.workspaceKey, savedTokens, excessTokens: 0, verdict: "unknown" };
    }
    const excessTokens = Math.round(excess * (w.compressionsInWindow / totalCompressions));
    return {
      workspaceKey: w.workspaceKey,
      savedTokens,
      excessTokens,
      verdict: excessTokens > savedTokens * ADVISORY_MARGIN ? "negative" : "ok",
    };
  });
}
