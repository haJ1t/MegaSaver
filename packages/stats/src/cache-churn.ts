import type { TokenSaverEvent } from "./event.js";
import { INPUT_PRICE_PER_MTOK_USD } from "./savings-headline.js";

export interface CacheChurnMetric {
  sessionId: string;
  workspaceKey: string;
  toolName: string;
  outputBytesRaw: number;
  outputBytesCompressed: number;
  cachePrefixInvalidated: boolean;
  estimatedCacheWriteTokens: number;
  netSavingsUsd: number;
  recommendation: "keep_enabled" | "increase_floor" | "bypass_compression";
  timestamp: string;
}

export interface CacheChurnResult {
  totalEvents: number;
  invalidatedCount: number;
  cacheInvalidationRate: number;
  totalSavedBytes: number;
  estimatedSavedTokens: number;
  netSavingsUsd: number;
  recommendation: CacheChurnMetric["recommendation"];
  perTool?: Record<string, { invalidatedCount: number; total: number }>;
}

export function analyzeCacheChurn(
  events: readonly TokenSaverEvent[],
  opts?: { pricePerMTokUsd?: number; now?: () => number },
): CacheChurnResult {
  void opts?.now;
  if (events.length === 0) {
    return {
      totalEvents: 0,
      invalidatedCount: 0,
      cacheInvalidationRate: 0,
      totalSavedBytes: 0,
      estimatedSavedTokens: 0,
      netSavingsUsd: 0,
      recommendation: "keep_enabled",
    };
  }

  const totalSavedBytes = events.reduce(
    (acc, e) => acc + ((e as unknown as { bytesSaved?: number }).bytesSaved ?? 0),
    0,
  );
  const totalRawBytes = events.reduce(
    (acc, e) => acc + ((e as unknown as { rawBytes?: number }).rawBytes ?? 0),
    0,
  );
  const avgSavingRatio = totalRawBytes === 0 ? 0 : totalSavedBytes / totalRawBytes;

  const hasDeltaTokens = events.some(
    (e) => typeof (e as unknown as { deltaTokens?: unknown }).deltaTokens === "number",
  );
  const estimatedSavedTokens = hasDeltaTokens
    ? events.reduce((acc, e) => {
        const dt = (e as unknown as { deltaTokens?: number }).deltaTokens;
        if (typeof dt === "number") return acc + dt;
        return acc + ((e as unknown as { bytesSaved?: number }).bytesSaved ?? 0) / 4;
      }, 0)
    : totalSavedBytes / 4;

  const pricePerToken = (opts?.pricePerMTokUsd ?? INPUT_PRICE_PER_MTOK_USD) / 1_000_000;
  const netSavingsUsd = Number((estimatedSavedTokens * pricePerToken).toFixed(6));

  // Invalidation heuristic: per-event savingRatio < 0.2 signals cache churn
  const invalidatedCount = events.filter((e) => {
    const sr = (e as unknown as { savingRatio?: number }).savingRatio;
    return typeof sr === "number" && sr < 0.2;
  }).length;
  const cacheInvalidationRate = invalidatedCount / events.length;

  let recommendation: CacheChurnResult["recommendation"] = "keep_enabled";
  if (cacheInvalidationRate > 0.5 && avgSavingRatio < 0.2) recommendation = "bypass_compression";
  else if (cacheInvalidationRate > 0.3 && events.length >= 5) recommendation = "increase_floor";

  const perTool: Record<string, { invalidatedCount: number; total: number }> = {};
  for (const e of events) {
    const tool = String((e as unknown as { sourceKind?: unknown }).sourceKind ?? "unknown");
    const cur = perTool[tool] ?? { invalidatedCount: 0, total: 0 };
    cur.total += 1;
    const sr = (e as unknown as { savingRatio?: number }).savingRatio;
    if (typeof sr === "number" && sr < 0.2) cur.invalidatedCount += 1;
    perTool[tool] = cur;
  }

  return {
    totalEvents: events.length,
    invalidatedCount,
    cacheInvalidationRate,
    totalSavedBytes,
    estimatedSavedTokens,
    netSavingsUsd,
    recommendation,
    perTool,
  };
}
