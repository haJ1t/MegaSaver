import { describe, expect, it } from "vitest";
import { classifyOutput } from "../src/classify.js";

// Sixth instance of the unbounded-run class (wiki: concepts/unbounded-run-redos):
// VITEST_OUT and PROSE_ANTI_VI each open alternatives with `^\s*` under `m`.
// `\s` matches `\n`, so inside a blank-line block every line start scans the
// whole remaining whitespace region before failing the required literal —
// O(starts x length). Both patterns sit on classifyOutput's path for text that
// reaches the prose check, so this one driver exercises both, and reverting
// either bound alone is enough to blow the ceiling.
//
// classifyOutput is a public export and only normalizes (it does NOT collapse),
// so `mega bench` — which hands it raw command output — has no shield. The
// filterOutput path happens to feed it post-collapseRepeatedLines text.
//
// On SIZE: 100 KB, not 50 KB. The defect is quadratic and the fix linear, so
// doubling the input quadruples the unbounded cost. Measured through this call
// site: 1.7 s at 25 KB, 6.6 s at 50 KB, 25.4 s at 100 KB. A 50 KB run under a
// loose ceiling can stay green. Do not lower SIZE.
//
// On the ceiling: 5 s matches the sibling suite (rank-redos.test.ts) and is
// deliberately loose — this file runs in a few ms bounded, under `turbo test`
// with ~12 packages in parallel. It catches the catastrophic regression, not a
// modest slowdown.
const CEILING_MS = 5_000;
const SIZE = 100_000;

const elapsed = (run: () => void): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

describe("classifyOutput — ReDoS regression on blank-line blocks", () => {
  // Pure newlines is the shape that survives `normalize`, which strips trailing
  // whitespace from every line: a padded log tail or a truncated stream arrives
  // here as one long run of empty lines.
  // A mixed space/tab/newline block was tried as a second driver and dropped:
  // unfixed it costs 3.6 s, under the ceiling, so it cannot go red on its own.
  it(`classifies ${SIZE / 1000} KB of blank lines under ${CEILING_MS} ms`, () => {
    expect(elapsed(() => classifyOutput({ text: "\n".repeat(SIZE) }))).toBeLessThan(CEILING_MS);
  });
});

describe("vitest signals still detected after bounding", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["a summary line", " Test Files  1 failed | 1 passed (2)"],
    ["an indented Tests count", "      Tests  1 failed | 4 passed (5)"],
    ["a tab-indented FAIL line", "\t\tFAIL src/c.test.ts > thing works"],
    ["a bare PASS line", "PASS src/a.test.ts"],
    ["a duration line", "   Duration  1.20s"],
  ];

  for (const [label, text] of cases) {
    it(`still classifies ${label} as vitest`, () => {
      expect(classifyOutput({ text }).category).toBe("vitest");
    });
  }
});
