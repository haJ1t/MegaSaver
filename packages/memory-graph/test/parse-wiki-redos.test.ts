import { describe, expect, it } from "vitest";
import { parseWikiPage } from "../src/parse-wiki.js";

// Instance 9 of the unbounded-run ReDoS class (wiki/concepts/unbounded-run-redos.md).
// The anchor strip in parse-wiki.ts was `/\s+#\S.*$/` — unanchored, non-global, and
// carrying BOTH documented variants of the class in one expression:
//
//   `\s+#`   unbounded whitespace run followed by a required literal, so every start
//            position inside a whitespace run rescans the run and then fails `#`.
//   `.*$`    unbounded run followed by a zero-width literal (the instance-8 variant),
//            so every `\s#\S` candidate scans to the next newline and backtracks to
//            zero when `$` fails.
//
// The string it runs on is `mm[1]` of `/\(source:\s*([^)]+)\)/g` — `[^)]+` accepts
// whitespace and newlines without bound — and neither read path caps page size:
// `mega memory graph <project>` (apps/cli/src/commands/memory/read-wiki.ts:38) and the
// GUI bridge memory-graph route (apps/gui/bridge/routes/memory-graph.ts:90) both
// readFile every wiki/{entities,concepts,decisions,syntheses,workflows,sources}/**/*.md
// and hand the whole file to parseWikiPage. One page with an unclosed `(source:` region
// stalls the command.
const SMALL = 12_500;
const LARGE = 50_000;

// Why a growth RATIO and not a wall-clock ceiling: a ceiling only guards what it
// separates, and the prior-art suite for this class documents four of five reverted
// bounds slipping under a 5 s ceiling on a fast idle runner. A 4x step in input size
// costs a linear implementation 4x; the quadratic form measured 12.7x (whitespace run)
// and 18.5x (`#` run) through this exported function. The threshold sits halfway
// between in log space, so both sides carry ~2x margin.
const MAX_GROWTH = 8;
const TRIALS = 5;

// Take the minimum PER SIZE and divide, never the minimum of per-trial ratios.
// Scheduler noise can only ever inflate a duration, so min-per-size converges on the
// true cost of each size from above. Minimising the ratio instead pairs an inflated
// SMALL sample with a clean LARGE one and reports a fraction of the true growth: on
// this machine, under load, that sampler read 2.94x where min-per-size read 7.63x —
// i.e. it hides the defect it exists to catch.
const ratioOf = (durations: ReadonlyArray<readonly [number, number]>): number => {
  const small = Math.min(...durations.map(([s]) => s));
  const large = Math.min(...durations.map(([, l]) => l));
  return large / small;
};

// Calibrated repeat count, not a fixed one: vitest cannot interrupt a synchronous loop
// (its `timeout` only fires at async boundaries), so a fixed count would multiply the
// quadratic 2.5 s call and hang for many minutes instead of going red on the ratio.
// Deriving the count from one real call spends ~60 ms per sample when linear and drops
// to a single repeat when it is not.
const TARGET_SAMPLE_MS = 60;

// The quadratic form needs ~70 s to produce its own red here, so the per-test budget
// has to clear that: the assertion, not a timeout, must be what fails when the fix is
// reverted. Fixed, both tests run in ~2 s.
const TIMEOUT_MS = 240_000;

const parse = (page: string): void => {
  parseWikiPage("concepts/probe.md", page);
};

const repeatsFor = (page: string): number => {
  parse(page); // warm up: keep JIT cost out of the estimate
  const started = performance.now();
  parse(page);
  const one = performance.now() - started;
  return Math.max(1, Math.round(TARGET_SAMPLE_MS / Math.max(one, 0.05)));
};

const sample = (page: string, repeats: number): number => {
  const started = performance.now();
  for (let i = 0; i < repeats; i += 1) parse(page);
  return performance.now() - started;
};

const growthRatio = (shape: (size: number) => string): number => {
  const small = shape(SMALL);
  const large = shape(LARGE);
  const repeats = repeatsFor(small);
  const durations: Array<readonly [number, number]> = [];
  for (let trial = 0; trial < TRIALS; trial += 1) {
    durations.push([sample(small, repeats), sample(large, repeats)]);
  }
  return ratioOf(durations);
};

const SHAPES: ReadonlyArray<readonly [string, (size: number) => string]> = [
  // The reported repro: one unclosed `(source:` region holding a single whitespace run.
  // Drives the `\s+#` half — every offset in the run is a start position. Measured
  // 148 / 198 / 648 / 4945 / 10919 ms at 12.5 / 25 / 50 / 100 KB before the fix.
  [
    "a whitespace run inside one (source: …) capture",
    (size) => `# t\n\n(source: a${" ".repeat(size)}b)\n`,
  ],
  // Drives the `.*$` half of the same expression: ~size/3 viable `\s#\S` candidates,
  // each scanning to the trailing newline before `$` fails and it backtracks to zero.
  // Reachable for the same reason — the capture is not size-capped either.
  [
    "a same-line # run before a newline",
    (size) => `# t\n\n(source: ${" #x".repeat(Math.floor(size / 3))}\nz)\n`,
  ],
];

describe("parseWikiPage — anchor-strip ReDoS on an uncapped wiki page", () => {
  for (const [label, shape] of SHAPES) {
    it(
      `grows no worse than ${MAX_GROWTH}x from ${SMALL / 1000} KB to ${
        LARGE / 1000
      } KB of ${label}`,
      () => {
        expect(growthRatio(shape)).toBeLessThan(MAX_GROWTH);
      },
      TIMEOUT_MS,
    );
  }
});

// Every expectation below was captured from the UNBOUNDED pattern before the fix, so
// these lock behaviour rather than describe it: they pass identically before and after.
// Verified as a set over the repo's own wiki — 75 pages, 54 `(source: …)` captures, 4 of
// them anchor-stripped, 0 divergent between the old and new expression.
describe("anchor strip unchanged after the fix", () => {
  const cases: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ["a single-space anchor", "(source: decisions/x.md #8)", ["decisions/x.md"]],
    ["a multi-space anchor", "(source: decisions/x.md    #sec-2)", ["decisions/x.md"]],
    ["a tab-separated anchor", "(source: decisions/x.md\t#sec)", ["decisions/x.md"]],
    [
      "an anchor after a line range",
      "(source: scripts/manifest.ts:25-72 #a)",
      ["scripts/manifest.ts"],
    ],
    // No whitespace before the `#` — it is part of the path token, not an anchor.
    ["a # inside the path token", "(source: docs/a#b/c.md)", ["docs/a#b/c.md"]],
    // Prose citation: the anchor goes, and what is left still is not a path.
    ["prose with a trailing # token", "(source: AA1 §2a; PR #75)", []],
    [
      "a citation with no anchor at all",
      "(source: packages/core/src/x.ts:12)",
      ["packages/core/src/x.ts"],
    ],
  ];

  for (const [label, body, expected] of cases) {
    it(`resolves ${label} the same way`, () => {
      expect(parseWikiPage("syntheses/s.md", body).fileCites).toEqual(expected);
    });
  }

  // The one deliberate divergence, pinned so it is a decision and not a surprise.
  // `.*$` refused to strip an anchor when a newline followed it, because `.` cannot
  // cross one — an artefact of the pattern, not of the intent, and it left the whole
  // multi-line blob as the file node id. Dropping the constraint (`[\s\S]*`) is what
  // makes the tail non-backtracking, and it strips strictly more: the citation now
  // resolves to the path instead of to `x.md #sec\nmore prose`.
  it("strips an anchor even when the citation continues on the next line", () => {
    const w = parseWikiPage("syntheses/s.md", "(source: docs/x.md #sec\nmore prose)");

    expect(w.fileCites).toEqual(["docs/x.md"]);
  });
});
