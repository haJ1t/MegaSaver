// A2 (spec 2026-07-28-saver-compression-integrity §W2): the single admission
// guard, shared by every entry point. Before this, only the hook path had one
// (record-output.ts), so the read and exec paths could deliver a replacement
// larger than the original with nothing to stop them.
//
// WHY A MINIMUM SAVING, AND WHY THESE NUMBERS.
//
// A rewrite that hands back nearly the same bytes does a full filter-persist-
// deliver pass for effectively nothing, and what a rewrite costs on the billed
// ledger is UNMEASURED — the in-place cache-churn mechanism this guard once
// cited was retracted (wiki/syntheses/saver-cache-churn, CORRECTION
// 2026-07-30). Refusing a near-no-op rewrite is the conservative stance on an
// unmeasured cost axis, and merely being non-negative does not rule one out —
// a one-byte saving used to pass this guard.
//
// The floors were parameters defaulting to off because any floor above ~1 KB
// re-opened the "aggressive dead band" PR #278 closed: with a FLAT 4000-byte
// budget a ~5 KB input saved only ~1 KB. §W1 lever (b) removed that premise —
// the budget is now a SHARE of the input (output-filter/fit.ts targetBudget),
// so the saving scales with the input instead of being what is left over after
// a constant.
//
// Measured 2026-07-29 through recordAndFilterOverlayOutput (the numbers the
// guard actually sees: summary + D16 markers + recovery footer, not
// filterOutput's returnedBytes), over 10 content shapes x 3 modes at raw sizes
// from the eligibility floor up to 50 KB. The worst cell anywhere at the floor
// was tsc-shaped output in safe mode at 2048 B: 619 B saved, ratio 0.302. The
// worst cell is always safe mode at the floor, because safe keeps the largest
// share (0.5) and the per-delivery overhead is largest relative to the input.
//
// Both floors are set ~2x below that worst cell. That is deliberate: their job
// is to reject a near-no-op rewrite, NOT to act as a second eligibility gate.
// Nothing above the eligibility floor in the measured corpus is refused, which
// is precisely why enabling them cannot re-open the #278 band. A floor tuned to
// bite (0.35 relative would refuse that tsc cell) would re-open it.
//
// What these numbers are NOT: an economic break-even. The per-rewrite cost is
// UNMEASURED (the ~18k churn tax once quoted here was retracted; the cost axis
// has no billed number until the A4 billed-S leg closes), so no floor in this
// range can claim to earn a specific cost back. Sizing the floors against real
// cost is the cost axis (§0, owned by 2026-07-19-net-positive-megasaver-design.md).
export type SavingFloors = {
  absoluteBytes: number;
  relative: number;
};

export const NO_FLOORS: SavingFloors = { absoluteBytes: 0, relative: 0 };

// The floors record-output.ts ships with. Passed explicitly at that call site
// rather than made the default parameter, so the read and exec paths — which
// call this guard for a different decision — keep their current behaviour until
// their own spec moves them.
export const DEFAULT_SAVING_FLOORS: SavingFloors = { absoluteBytes: 256, relative: 0.15 };

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
