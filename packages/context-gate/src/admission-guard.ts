// A2 (spec 2026-07-28-saver-compression-integrity §W2): the single admission
// guard, shared by every entry point. Before this, only the hook path had one
// (record-output.ts), so the read and exec paths could deliver a replacement
// larger than the original with nothing to stop them.
//
// WHAT THIS GUARD DOES NOT DECIDE, AND WHY.
//
// The obvious next move is to demand a MINIMUM saving rather than merely a
// non-negative one: rewriting a tool_result mutates the conversation prefix and
// invalidates the client's native prompt cache, so the prefix is re-billed as
// cache creation, and a rewrite saving a handful of bytes is strictly negative
// (wiki/syntheses/saver-cache-churn: measured 0.93-0.97x, worse than baseline).
//
// That reasoning is sound and it is deliberately NOT applied here yet:
//
//   1. It is the cost axis, which spec §0 assigns to
//      2026-07-19-net-positive-megasaver-design.md, not to this spec. This
//      spec owns integrity and ratio.
//   2. A minimum-saving floor directly contradicts shipped, tested behaviour:
//      PR #278 closed the "aggressive dead band" so a ~5 KB output WOULD
//      compress (see record-output.test.ts, "B8: a ~5KB aggressive output
//      compresses"). At a 4 KB budget that saving is ~1 KB — any floor above it
//      silently re-opens the band that fix closed. The churn measurement is
//      later evidence than #278 and may well win, but reversing a shipped
//      decision belongs in a spec, not in a helper's constant.
//   3. Choosing the number before Track B's B4 measures the real token cost of
//      a cache re-creation would be guessing, and a guessed floor tuned until
//      the tests go green is worse than no floor.
//
// So the floors exist as parameters and default to off. When B4 publishes its
// numbers, the net-positive spec decides whether to enable them and at what
// value — one edit, at one call site, with the trade-off already written down.
export type SavingFloors = {
  absoluteBytes: number;
  relative: number;
};

export const NO_FLOORS: SavingFloors = { absoluteBytes: 0, relative: 0 };

export type AdmissionVerdict =
  | { admit: true }
  | { admit: false; reason: "inflates" | "below_absolute_floor" | "below_relative_floor" };

export function admitCompression(
  rawBytes: number,
  returnedBytes: number,
  floors: SavingFloors = NO_FLOORS,
): AdmissionVerdict {
  // Never deliver a replacement at least as large as the original. This also
  // structurally preserves the honest-metrics invariant returnedTokens <= rawTokens.
  if (returnedBytes >= rawBytes) return { admit: false, reason: "inflates" };
  const saved = rawBytes - returnedBytes;
  if (saved < floors.absoluteBytes) return { admit: false, reason: "below_absolute_floor" };
  if (rawBytes > 0 && saved / rawBytes < floors.relative) {
    return { admit: false, reason: "below_relative_floor" };
  }
  return { admit: true };
}
