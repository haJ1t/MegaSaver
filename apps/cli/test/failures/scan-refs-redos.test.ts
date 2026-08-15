import { describe, expect, it } from "vitest";
import { MAX_FAILURES_INPUT_BYTES, scanRefs } from "../../src/commands/failures/scan-refs.js";

// Instrument per wiki concepts/redos-growth-ratio-measurement:
// - Ratio, not ceiling: input is arbitrary text up to the shipped cap; there is
//   no fixed defect cost to separate from. 4n IS the cap — no caller can
//   present a larger scan (Task 5 boundary enforcement).
// - Minimise per SIZE across trials, then divide — never min-of-ratios.
// - Repeat count calibrated from one real call; duration floor ~5 ms so the
//   ratio never measures the scheduler. Never assert a runtime lower bound.
const SMALL = MAX_FAILURES_INPUT_BYTES / 4; // 2 MiB
const LARGE = MAX_FAILURES_INPUT_BYTES; // 8 MiB — the shipped cap
const RATIO_THRESHOLD = 8;
const TRIALS = 3;
const TARGET_SAMPLE_MS = 50;

function repeatTo(unit: string, bytes: number): string {
  return unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
}

// Near-miss shapes: starts that ENTER a pattern and fail. The word-char run
// probes the \b-guarded cs- head and the token validators; the cs- soup probes
// the bounded hex run (exactly where an unbounded {8,} edit would bite); the
// slashy soup probes the slash-path alternation tail.
const SHAPES: ReadonlyArray<readonly [string, string]> = [
  ["a word-char run", "x"],
  ["cs- near-miss soup", "cs-abc cs-ab cs-a "],
  ["slashy token soup", "src/a src/ b//c ./x. "],
];

function minMsPerSize(input: string, repeats: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const started = performance.now();
    for (let r = 0; r < repeats; r += 1) scanRefs(input);
    const ms = (performance.now() - started) / repeats;
    if (ms < best) best = ms;
  }
  return best;
}

describe("scanRefs stays linear up to the shipped input cap", () => {
  for (const [label, unit] of SHAPES) {
    it(`grows ~linearly from 2 MiB to 8 MiB of ${label}`, { retry: 3, timeout: 120_000 }, () => {
      const small = repeatTo(unit, SMALL);
      const large = repeatTo(unit, LARGE);
      const probeMs = Math.max(minMsPerSize(small, 1), 0.5);
      const repeats = Math.max(1, Math.round(TARGET_SAMPLE_MS / probeMs));
      const smallMs = minMsPerSize(small, repeats);
      const largeMs = minMsPerSize(large, repeats);
      expect(largeMs / smallMs).toBeLessThan(RATIO_THRESHOLD);
    });
  }
});

describe("guard corpus is not vacuous", () => {
  // redos-guard-testing rule: assert a minimum match count before asserting
  // anything about what a corpus produced.
  const SEEDED = `stored in cs-${"ab12".repeat(8)} and cs-${"7".repeat(16)}; touched src/commands/alerts.ts, ./docs/plan.md and package.json`;

  it("both ref kinds fire on the seeded corpus", () => {
    const refs = scanRefs(SEEDED);
    expect(refs.chunkRefs.length).toBeGreaterThanOrEqual(2);
    expect(refs.pathRefs.length).toBeGreaterThanOrEqual(3);
  });
});
