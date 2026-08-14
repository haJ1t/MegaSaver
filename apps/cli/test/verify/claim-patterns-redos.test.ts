import { describe, expect, it } from "vitest";
import {
  CLAIM_PATTERNS,
  MAX_CLAIMS_INPUT_BYTES,
  scanClaims,
} from "../../src/commands/verify/claim-patterns.js";

// Instrument per wiki concepts/redos-growth-ratio-measurement:
// - A ratio, not a ceiling, because there is no fixed defect cost to separate
//   from: input is arbitrary text up to the shipped cap and the corpus is
//   synthetic. 4n IS the shipped cap (MAX_CLAIMS_INPUT_BYTES) — no caller can
//   present a larger scan.
// - 4x size step: linear predicts ~4.0, the unbounded-run defect class
//   measured 12.7–18.5x in prior instances; threshold 8 leaves ~2x margin on
//   both sides.
// - Minimise per SIZE across trials, then divide — never min-of-ratios (it
//   pairs a noisy small with a clean large and under-reports growth).
// - Repeat count calibrated from one real call, so a quadratic revert
//   collapses to a single repeat instead of a loop vitest cannot interrupt.
// - retry: 3 for parallel-turbo noise (the session-hints precedent). If this
//   still flakes under full fan-out, follow that file's escalation: replace
//   the ratio with a ceiling at the shipped cap once a measured separation
//   exists. Never assert a runtime lower bound.
const SMALL = MAX_CLAIMS_INPUT_BYTES / 4; // 2 MiB
const LARGE = MAX_CLAIMS_INPUT_BYTES; // 8 MiB — the shipped cap
const RATIO_THRESHOLD = 8;
const TRIALS = 3;
const TARGET_SAMPLE_MS = 50;

function repeatTo(unit: string, bytes: number): string {
  return unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
}

// Near-miss shapes: starts that enter a pattern and fail. The word-char run
// probes the \b-guarded heads; the whitespace shape probes the bounded
// `[ \t]{1,3}` gaps (exactly where an edit would reintroduce an unbounded
// `\s+`); the truncated-claim soup probes the alternation tails.
const SHAPES: ReadonlyArray<readonly [string, string]> = [
  ["a word-char run", "x"],
  ["a claim head before a whitespace run", "tests \t \t \t \t"],
  ["truncated-claim soup", "all tests pas build succee pnpm verify gree "],
];

function minMsPerSize(input: string, repeats: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const started = performance.now();
    for (let r = 0; r < repeats; r += 1) scanClaims(input);
    const ms = (performance.now() - started) / repeats;
    if (ms < best) best = ms;
  }
  return best;
}

describe("claim patterns stay linear up to the shipped input cap", () => {
  for (const [label, unit] of SHAPES) {
    it(`grows ~linearly from 2 MiB to 8 MiB of ${label}`, { retry: 3, timeout: 120_000 }, () => {
      const small = repeatTo(unit, SMALL);
      const large = repeatTo(unit, LARGE);

      // Duration-floor calibration: one real call sizes the repeat count so
      // a linear sample spends ~TARGET_SAMPLE_MS (below ~5 ms a ratio
      // measures the scheduler), and a quadratic revert drops to 1 repeat.
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
  // anything about what a corpus produced. Every locked pattern must fire at
  // least once, or the growth measurement above proved nothing for it.
  const SEEDED =
    "All tests pass. all green. Build succeeded and build is green. " +
    "The test suite is green. pnpm verify passes. lint is clean. " +
    "typecheck passed. all checks passed. tests are passing. suite passes.";

  it("every locked pattern matches the seeded corpus at least once", () => {
    const hits = scanClaims(SEEDED);
    for (const pattern of CLAIM_PATTERNS) {
      expect(
        hits.some((claim) => claim.patternId === pattern.id),
        `pattern ${pattern.id} never fired`,
      ).toBe(true);
    }
  });
});
