export interface ProxyModelRow {
  atMs: number;
  modelId: string;
}

export interface ModelResolutionInput {
  eventAtMs: number;
  windowMs: number;
  proxyRows: readonly ProxyModelRow[];
  configuredDefaultModelId?: string | undefined;
}

// Order: observed (proxy ledger) -> declared (operator config) -> unknown.
// There is no fourth step. The saver hook does not see the model, and a guess
// dressed as provenance is worse than an honest absence: an absent id is
// priced at the fallback AND counted in the visible unknown share, while a
// guess is counted as known.
export function resolveModelId(input: ModelResolutionInput): string | undefined {
  let best: ProxyModelRow | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const row of input.proxyRows) {
    const distance = Math.abs(row.atMs - input.eventAtMs);
    if (distance <= input.windowMs && distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }

  return best?.modelId ?? input.configuredDefaultModelId;
}
