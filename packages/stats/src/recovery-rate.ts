import type { TokenSaverEvent } from "./event.js";

// R for the A4 gate: the share of compressed outputs that the agent pulled back.
//
// B3 started writing `kind: "expansion"` rows so recovery could be charged
// against the savings, but nothing ever read the field — the ledger could show
// net bytes while the RATE stayed invisible, and the rate is the only quantity
// the break-even bound R* (packages/bench-replay recovery-breakeven.ts) can be
// compared against.
//
// Measured at OUTPUT level, matching R*'s definition, and pessimistically:
//   - an output expanded by one chunk counts the same as one expanded in full,
//     because R* prices every expansion as a FULL one;
//   - so R overstates recovery, and has to beat its bound anyway.
//
// Rows with no `chunkSetId` are excluded from both sides: nothing was stored, so
// the output cannot be recovered and does not belong in a recovery share.

export type RecoveryRate = {
  compressed: number;
  expanded: number;
  rate: number;
};

export function recoveryRate(events: readonly TokenSaverEvent[]): RecoveryRate {
  const compressedSets = new Set<string>();
  const expandedSets = new Set<string>();

  for (const event of events) {
    const chunkSetId = event.chunkSetId;
    if (typeof chunkSetId !== "string" || chunkSetId === "") continue;
    // Absent `kind` means compression: every row written before B3 is one.
    if (event.kind === "expansion") expandedSets.add(chunkSetId);
    else compressedSets.add(chunkSetId);
  }

  // An expansion of an output this ledger never compressed (another project, or
  // a compression row since pruned) is not a share of anything here. Counting it
  // could push the rate past 1 and leave the gate unreadable.
  let expanded = 0;
  for (const id of expandedSets) if (compressedSets.has(id)) expanded += 1;

  const compressed = compressedSets.size;
  // No denominator, no number — the same posture the rest of this codebase
  // takes. Zero would read as "nothing was pulled back", a pass the data did
  // not earn.
  if (compressed === 0) return { compressed, expanded, rate: Number.NaN };

  return { compressed, expanded, rate: expanded / compressed };
}
