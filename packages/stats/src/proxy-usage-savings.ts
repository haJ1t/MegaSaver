// Fuses saver-hook compression savings (numerator) with the metering proxy's
// real per-call token counts (denominator) into a "% of total Claude usage
// saved" estimate. Pure: all I/O (reading usage.jsonl + overlay summaries) is
// the caller's job; this only does the trust-sensitive arithmetic.
//
// Why saved is ADDED to the actuals: the proxy's token counts already reflect
// the COMPRESSED tool outputs that flowed to the model. `saved` is what was
// removed before they flowed. `actual + saved` therefore counts each tool output
// once at its full pre-compression size — no double counting.

export interface ProxyUsageTokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface ProxyUsageSavings {
  savedTokens: number;
  proxyCalls: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  // Context written once this session (new, non-cached).
  newContextTokens: number;
  // Adds cached re-reads — the full input load the model processed across turns.
  totalContextTokens: number;
  savedShareOfNewContext: number;
  savedShareOfTotalContext: number;
  // False when the numerator structurally exceeds the measured new context
  // (`saved > newContext`). That is the fingerprint of an untrustworthy ratio:
  // the proxy captured only part of the workload, or a stray old usage row
  // skewed the window. Callers MUST suppress the percentages when this is false
  // and show the raw counts instead — a confident 97% built on two proxy calls
  // is worse than no number.
  reliable: boolean;
}

// Sum compression savings whose event time is at or after `sinceMs`. Used to
// scope the numerator to the proxy's metering window so a "% of total" ratio
// compares the same period on both sides (all-time savings vs a few recent proxy
// calls would be meaningless). Non-finite times / bytes are skipped.
export function sumBytesSavedSince(
  events: readonly { createdAt: string; bytesSaved: number }[],
  sinceMs: number,
): number {
  let total = 0;
  for (const e of events) {
    const t = Date.parse(e.createdAt);
    if (Number.isFinite(t) && t >= sinceMs && Number.isFinite(e.bytesSaved)) {
      total += e.bytesSaved;
    }
  }
  return total;
}

export function proxyUsageSavings(input: {
  savedTokens: number;
  usage: readonly ProxyUsageTokenCounts[];
}): ProxyUsageSavings {
  const saved = Math.max(0, Math.round(input.savedTokens));

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  for (const u of input.usage) {
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    cacheReadTokens += u.cacheReadTokens;
    cacheCreationTokens += u.cacheCreationTokens;
  }

  const newContextTokens = inputTokens + cacheCreationTokens;
  const totalContextTokens = newContextTokens + cacheReadTokens;

  const shareOf = (actual: number): number => {
    const wouldHave = saved + actual;
    return wouldHave === 0 ? 0 : saved / wouldHave;
  };

  return {
    savedTokens: saved,
    proxyCalls: input.usage.length,
    inputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    outputTokens,
    newContextTokens,
    totalContextTokens,
    savedShareOfNewContext: shareOf(newContextTokens),
    savedShareOfTotalContext: shareOf(totalContextTokens),
    reliable: newContextTokens > 0 && saved <= newContextTokens,
  };
}
