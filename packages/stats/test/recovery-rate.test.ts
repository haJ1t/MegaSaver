import { describe, expect, it } from "vitest";
import type { TokenSaverEvent } from "../src/event.js";
import { recoveryRate } from "../src/recovery-rate.js";

// The A4 gate reads "net cheaper as long as R < R*". R* is derived offline from
// a recording (packages/bench-replay recovery-breakeven.ts). R is the thing that
// has to come from real use — and until now it could not, because nothing read
// the `kind` field. B3 writes expansion rows; no consumer separated them, so the
// ledger could show net bytes but never "what FRACTION of compressed outputs
// were pulled back", which is the only quantity R* can be compared against.
//
// R is deliberately measured at OUTPUT level, matching R*'s definition: the
// share of compressed outputs that were expanded at all. R* assumes each
// expanded output is expanded in FULL, so counting a single-chunk fetch as a
// whole expansion overstates R. That is the safe direction — R has to beat a
// bound while being measured pessimistically.

let seq = 0;
function event(over: Partial<TokenSaverEvent> = {}): TokenSaverEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    sessionId: "01J0000000000000000000000A",
    projectId: "proj",
    createdAt: "2026-07-30T00:00:00.000Z",
    sourceKind: "command",
    label: "l",
    rawBytes: 1000,
    returnedBytes: 200,
    bytesSaved: 800,
    savingRatio: 0.8,
    summary: "s",
    ...over,
  } as TokenSaverEvent;
}

const compression = (chunkSetId: string) => event({ chunkSetId, kind: "compression" });
const expansion = (chunkSetId: string) =>
  event({ chunkSetId, kind: "expansion", rawBytes: 0, bytesSaved: 0, savingRatio: 0 });

describe("recoveryRate", () => {
  it("is the share of compressed outputs that were expanded", () => {
    const r = recoveryRate([
      compression("cs-1"),
      compression("cs-2"),
      compression("cs-3"),
      compression("cs-4"),
      expansion("cs-1"),
    ]);
    expect(r.compressed).toBe(4);
    expect(r.expanded).toBe(1);
    expect(r.rate).toBe(0.25);
  });

  it("counts an output once however many of its chunks were fetched", () => {
    // Six fetches against one output is still ONE expanded output. Counting
    // fetches would let a single heavily-chunked output push the rate past 1.
    const r = recoveryRate([
      compression("cs-1"),
      compression("cs-2"),
      ...Array.from({ length: 6 }, () => expansion("cs-1")),
    ]);
    expect(r.expanded).toBe(1);
    expect(r.rate).toBe(0.5);
  });

  it("treats a row with no kind as a compression, as every pre-B3 row is", () => {
    const legacy = event({ chunkSetId: "cs-9" });
    expect(legacy.kind).toBeUndefined();
    const r = recoveryRate([legacy]);
    expect(r.compressed).toBe(1);
    expect(r.rate).toBe(0);
  });

  it("returns NaN rather than a rate when nothing was ever compressed", () => {
    // Same posture as the rest of this codebase: no denominator, no number.
    // Reporting 0 would read as "nothing was pulled back", which is a passing
    // grade the data did not earn.
    const r = recoveryRate([]);
    expect(r.compressed).toBe(0);
    expect(r.rate).toBeNaN();
  });

  it("ignores an expansion whose output this ledger never compressed", () => {
    // A chunk set from another project/session, or one whose compression row was
    // pruned. It cannot be counted in a share of THIS ledger's compressions —
    // that could push the rate above 1 and make the gate unreadable.
    const r = recoveryRate([compression("cs-1"), expansion("cs-unknown")]);
    expect(r.compressed).toBe(1);
    expect(r.expanded).toBe(0);
    expect(r.rate).toBe(0);
  });

  it("never reports a rate above 1", () => {
    const r = recoveryRate([
      compression("cs-1"),
      expansion("cs-1"),
      expansion("cs-1"),
      expansion("cs-2"),
    ]);
    expect(r.rate).toBeLessThanOrEqual(1);
  });

  it("skips rows with no chunkSetId instead of miscounting them", () => {
    // A compression that stored nothing is not recoverable, so it cannot be
    // expanded and does not belong in the denominator of a recovery share.
    const r = recoveryRate([event({ kind: "compression" }), compression("cs-1")]);
    expect(r.compressed).toBe(1);
  });
});
