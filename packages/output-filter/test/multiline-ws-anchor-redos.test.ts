import { describe, expect, it } from "vitest";
import { collapseRepeatedLines, normalize } from "../src/normalize.js";
import { detectEslint } from "../src/parsers/eslint.js";
import { detectGoTest } from "../src/parsers/go-test.js";
import { detectTestOutput } from "../src/parsers/test-output.js";
import { type Chunk, scoreChunk } from "../src/rank.js";

// Seventh instance of the unbounded-run class (wiki: concepts/unbounded-run-redos),
// and the siblings the sixth fix missed: it bounded classify.ts's two `^\s*`-under-`m`
// patterns and stopped there, leaving five more in this package —
// rank.ts TEST_FAILURE, go-test FAIL_LINE, eslint SUMMARY + PROBLEM_ROW,
// test-output SIGNATURE.
//
// The driver is a run of U+2028 LINE SEPARATOR (U+2029 behaves identically).
// Under `m`, `^` anchors after every U+2028 AND `\s` matches it, so an
// unbounded `\s*`/`\s+` rescans the whole remaining run from each of those
// anchors — O(starts x length).
//
// Why the pipeline's pre-filter does not shield these: `normalize` splits on
// `\n` only and `collapseRepeatedLines` folds identical `\n`-lines, so a
// U+2028 run survives both as a single logical line and reaches every pattern
// below. That is what the "survives the pre-filter" assertion pins. A `\n` run
// is folded to a marker and a space/tab run leaves a single anchor, so neither
// fires — this shape is crafted input, not accidental like instances 6 and 7.
//
// Each timing block drives exactly ONE unbounded quantifier through its real
// call site, and each was verified to go red on its own when that single bound
// is reverted and the other four left bounded (30.5 / 29.9 / 30.0 / 30.7 /
// 33.5 s, in file order below).
//
// On SIZE: 200 KB. The defect is quadratic and the fix linear, so length is the
// cheap separator. Measured through detectGoTest: 0.5 s at 25 KB, 1.9 s at
// 50 KB, 7.6 s at 100 KB — a 100 KB run clears the 5 s ceiling by only 1.5x,
// thin enough for a loaded runner to hide. At 200 KB the cheapest single
// reversion costs 29.9 s, 6x the ceiling, while all 28 tests together run in
// 200 ms bounded. Do not lower SIZE.
//
// On the ceiling: 5 s matches the sibling suites (rank-redos, classify-redos)
// and is deliberately loose — this file runs in well under a second bounded,
// under `turbo test` with ~12 packages in parallel.
const CEILING_MS = 5_000;
const SIZE = 200_000;
// The trailing `x` is load-bearing: `normalize` trimEnds every `\n`-line and
// ES `\s` (so `trimEnd`) includes U+2028, so a run AT end-of-line is stripped
// entirely. Only a run with something after it survives to the parsers.
const LINE_SEPARATOR_RUN = `${"\u2028".repeat(SIZE)}x`;

const elapsed = (run: () => void): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

describe("U+2028 runs survive the pre-filter", () => {
  // Load-bearing for every timing block below: if normalize or
  // collapseRepeatedLines ever folded this run, the drivers would stop being
  // realistic and the ceilings would pass for the wrong reason.
  it("reaches the parsers at full length", () => {
    expect(collapseRepeatedLines(normalize(LINE_SEPARATOR_RUN))).toHaveLength(SIZE + 1);
  });
});

describe("parser detectors — ReDoS regression on U+2028 runs", () => {
  it(`detectGoTest scans ${SIZE / 1000} KB under ${CEILING_MS} ms`, () => {
    expect(elapsed(() => detectGoTest(LINE_SEPARATOR_RUN))).toBeLessThan(CEILING_MS);
  });

  // No `✖` anywhere, so SUMMARY scans the whole run and fails — and its `&&`
  // short-circuits before PROBLEM_ROW. This block isolates SUMMARY.
  it(`detectEslint scans ${SIZE / 1000} KB under ${CEILING_MS} ms`, () => {
    expect(elapsed(() => detectEslint(LINE_SEPARATOR_RUN))).toBeLessThan(CEILING_MS);
  });

  // The summary line comes FIRST so SUMMARY matches at offset 0 for free and
  // the `&&` reaches PROBLEM_ROW, which then scans the run. Without this
  // header PROBLEM_ROW is unreachable and its bound is untested.
  it(`detectEslint reaches PROBLEM_ROW on ${SIZE / 1000} KB under ${CEILING_MS} ms`, () => {
    const withSummary = `✖ 3 problems (3 errors, 0 warnings)${LINE_SEPARATOR_RUN}`;
    expect(elapsed(() => detectEslint(withSummary))).toBeLessThan(CEILING_MS);
  });

  it(`detectTestOutput scans ${SIZE / 1000} KB under ${CEILING_MS} ms`, () => {
    expect(elapsed(() => detectTestOutput(LINE_SEPARATOR_RUN))).toBeLessThan(CEILING_MS);
  });
});

describe("scoreChunk — ReDoS regression on U+2028 runs via TEST_FAILURE", () => {
  // The other three patterns scoreChunk runs (EXCEPTION_NAME, FILE_PATH,
  // STACKTRACE) were bounded by instances 2 and 3, so this shape isolates
  // TEST_FAILURE's `\s*` alternative.
  it(`scores ${SIZE / 1000} KB under ${CEILING_MS} ms`, () => {
    const chunk: Chunk = { text: LINE_SEPARATOR_RUN, startLine: 1, endLine: 1 };
    expect(elapsed(() => scoreChunk(undefined, chunk))).toBeLessThan(CEILING_MS);
  });
});

describe("signals still detected after bounding", () => {
  const goTest: ReadonlyArray<readonly [string, string, boolean]> = [
    ["a bare fail line", "--- FAIL: TestThing (0.00s)", true],
    ["an indented subtest fail", "    --- FAIL: TestThing/sub (0.00s)", true],
    ["a tab-indented fail line", "\t--- FAIL: TestThing (0.00s)", true],
    ["a fail line after a header", "=== RUN   TestThing\n--- FAIL: TestThing (0.00s)", true],
    ["a pass line", "--- PASS: TestThing (0.00s)", false],
  ];

  for (const [label, text, expected] of goTest) {
    it(`detectGoTest ${expected ? "detects" : "rejects"} ${label}`, () => {
      expect(detectGoTest(text)).toBe(expected);
    });
  }

  const eslintReport = [
    "/src/app.ts",
    "  1:1   error    'x' is defined but never used  no-unused-vars",
    "  12:5  warning  Unexpected console statement    no-console",
    "",
    "✖ 2 problems (1 error, 1 warning)",
  ].join("\n");

  const eslint: ReadonlyArray<readonly [string, string, boolean]> = [
    ["a full report", eslintReport, true],
    ["an indented summary", `${eslintReport.replace("✖", "  ✖")}`, true],
    [
      "a single-problem report",
      "/a.ts\n  3:9  error  Bad  rule\n\n✖ 1 problem (1 error, 0 warnings)",
      true,
    ],
    ["a report with no summary", "/src/app.ts\n  1:1  error  x  no-unused-vars", false],
    ["a summary with no problem rows", "✖ 2 problems (1 error, 1 warning)", false],
  ];

  for (const [label, text, expected] of eslint) {
    it(`detectEslint ${expected ? "detects" : "rejects"} ${label}`, () => {
      expect(detectEslint(text)).toBe(expected);
    });
  }

  const testOutput: ReadonlyArray<readonly [string, string, boolean]> = [
    ["a PASS line", "PASS src/a.test.ts", true],
    ["a FAIL line", "FAIL src/a.test.ts", true],
    ["an indented check mark", "   ✓ adds numbers", true],
    ["a tab-indented cross", "\t✗ adds numbers", true],
    ["a bare multiplication-sign row", "× adds numbers", true],
    ["a totals line", "Tests:  1 failed, 4 passed, 5 total", true],
    ["plain prose", "the build finished cleanly", false],
  ];

  for (const [label, text, expected] of testOutput) {
    it(`detectTestOutput ${expected ? "detects" : "rejects"} ${label}`, () => {
      expect(detectTestOutput(text)).toBe(expected);
    });
  }

  const chunk = (text: string): Chunk => ({ text, startLine: 1, endLine: 1 });
  const testFailure: ReadonlyArray<readonly [string, string, number]> = [
    ["a bare FAIL line", "FAIL src/a.test.ts", 4],
    ["an indented cross row", "   ✗ adds numbers", 4],
    ["a tab-indented cross row", "\t\t× adds numbers", 4],
    ["a failed count", "Tests:  2 failed, 4 passed", 4],
    ["a passing row", "   ✓ adds numbers", 0],
  ];

  for (const [label, text, expected] of testFailure) {
    it(`scoreChunk ${expected > 0 ? "still scores" : "still ignores"} ${label}`, () => {
      expect(scoreChunk(undefined, chunk(text)).features.testFailureScore).toBe(expected);
    });
  }
});
