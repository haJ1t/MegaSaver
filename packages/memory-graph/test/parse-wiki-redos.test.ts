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
// One size, large enough that the ceiling is decided by the defect and not by the
// machine. The ratio gate this file used to carry read 15.9x and 12.6x under a
// 55-task parallel `turbo` run while measuring 2-4x idle: sustained load inflates
// the large sample more than the small one, and min-per-size cannot cancel that
// because every trial is slow. An absolute ceiling has no such coupling — it is a
// question about one duration, and at this size the two implementations are five
// orders of magnitude apart. Same instrument as the sibling context-gate suite
// after 0e8f3362 (#301), for the same reason.
const PAGE_SIZE = 200_000;

// Measured at PAGE_SIZE, one call, this machine: bounded 0.1-0.2 ms on both shapes;
// the reverted `/\s+#\S.*$/` costs 34,000 ms (whitespace run) and 4,740 ms (`#` run).
// The ceiling sits against the *tail* of that pair — 19x above the cheapest red and
// ~2,000x above the most expensive green.
const CEILING_MS = 250;

// The reverted form needs ~34 s on the whitespace shape, so the per-test budget has
// to clear that: the assertion, not a timeout, must be what fails on a revert.
const TIMEOUT_MS = 240_000;

const elapsed = (page: string): number => {
  parseWikiPage("concepts/probe.md", page); // warm up: keep JIT cost out of the sample
  const started = performance.now();
  parseWikiPage("concepts/probe.md", page);
  return performance.now() - started;
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
      `scans ${PAGE_SIZE / 1000} KB of ${label} in under ${CEILING_MS} ms`,
      () => {
        expect(elapsed(shape(PAGE_SIZE))).toBeLessThan(CEILING_MS);
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
