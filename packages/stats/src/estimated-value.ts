import { tokensFromBytes } from "./honest-metrics.js";
import { type ModelPriceTable, inputPricePerMTok } from "./model-prices.js";

export interface ValuedRow {
  deltaTokens?: number | undefined;
  deltaBytes?: number | undefined;
  modelId?: string | undefined;
}

export interface SavedValueEstimate {
  // Measured tokens ONLY. Never mixed with the bytes/4 fallback below.
  netTokensMeasured: number;
  // The bytes/4 reading of rows that carry no measured tokens, reported so a
  // partially-measured window cannot look fully measured.
  unmeasuredTokensEstimated: number;
  measuredCoverage: number;
  unknownModelTokenShare: number;
  fallbackModelId?: string | undefined;
  fallbackInputPerMTokUsd?: number | undefined;
  // Signed. Negative when recovery outweighed compression — displayed, not clamped.
  estimatedUsd: number;
  capturedAt: string;
}

export function estimateSavedValue(
  rows: readonly ValuedRow[],
  table: ModelPriceTable,
): SavedValueEstimate {
  let netTokensMeasured = 0;
  let unmeasuredTokensEstimated = 0;
  let measuredRows = 0;
  let unknownMagnitude = 0;
  let totalMagnitude = 0;
  let estimatedUsd = 0;

  for (const row of rows) {
    // `null` is not type-valid here and the event schema rejects it, but the
    // check is written for both: a null slipping through would be counted as a
    // measured row contributing zero dollars, inflating measuredCoverage while
    // the figure it reports is absent. Absent must read as absent.
    if (row.deltaTokens === undefined || row.deltaTokens === null) {
      unmeasuredTokensEstimated += tokensFromBytes(row.deltaBytes ?? 0);
      continue;
    }
    measuredRows += 1;
    netTokensMeasured += row.deltaTokens;

    const price = inputPricePerMTok(table, row.modelId);
    estimatedUsd += (row.deltaTokens * price.usd) / 1_000_000;

    // Shares are computed on MAGNITUDE: a window with +1M known and -1M
    // unknown has a zero net, and a share computed on the net would divide by
    // zero or report 0% unknown for a window that is half unknown.
    const magnitude = Math.abs(row.deltaTokens);
    totalMagnitude += magnitude;
    if (price.resolvedAs === "unknown") unknownMagnitude += magnitude;
  }

  const fallback = table.prices[table.unknownModelId];
  return {
    netTokensMeasured,
    unmeasuredTokensEstimated,
    measuredCoverage: rows.length === 0 ? 1 : measuredRows / rows.length,
    unknownModelTokenShare: totalMagnitude === 0 ? 0 : unknownMagnitude / totalMagnitude,
    fallbackModelId: table.unknownModelId,
    fallbackInputPerMTokUsd: fallback?.inputPerMTokUsd,
    estimatedUsd,
    capturedAt: table.capturedAt,
  };
}
