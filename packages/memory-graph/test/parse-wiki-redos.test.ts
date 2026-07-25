import { describe, expect, it } from "vitest";
import { parseWikiPage } from "../src/parse-wiki.js";

// The wikilink scanner `/\[\[([^\]]+)\]\]/g` is the unbounded-run shape: the
// class `[^\]]` accepts `[`, so on a run of `[` every `[[` pair starts a scan to
// end-of-input before failing the required `]]`. Quadratic, measured through the
// real exported parseWikiPage on a run of `[`, one cold process per size:
// 1,158 / 5,847 / 32,755 ms at 25 / 50 / 100 KB.
//
// There is no size cap anywhere ahead of this: both walkers (the `mega memory
// graph` CLI at apps/cli/src/commands/memory/read-wiki.ts:38 and the GUI bridge
// at apps/gui/bridge/routes/memory-graph.ts:90) readFile every wiki page whole
// and hand the entire body to parseWikiPage. 32 KB is therefore a real page
// size, not a synthetic probe — the largest page the walkers actually scan today
// is wiki/syntheses/memory-moat-sketches.md at 57,576 bytes.
const PAGE_SIZE = 32_000;
const HALF_PAGE_SIZE = PAGE_SIZE / 2;

// A growth RATIO rather than a wall-clock ceiling, for the reason recorded in
// wiki/concepts/unbounded-run-redos.md: a ceiling is load- and runtime-dependent
// and a reverted bound can slip under it on a fast idle runner, while the ratio
// separates quadratic from linear by construction. Reverting the fix measured
// 3.7-4.2x (`[` run) and 3.5-3.6x (`[[` run) through this exact sampler; the
// bounded form measures 0.7-1.0x. The threshold sits between the two with >1.4x
// of headroom on each side.
const MAX_GROWTH = 2.5;
const TRIALS = 5;

// min-of-trials, not mean: scheduler noise can only inflate a duration, so a
// spike in the large sample inflates that trial's ratio and a spike in the small
// sample deflates it. The minimum discards inflated trials and can only make the
// assertion harder to pass.
//
// The repeat count is calibrated from one real call instead of fixed, because
// vitest cannot interrupt a synchronous loop — a fixed count would multiply the
// pathological 587 ms call and hang instead of going red. Calibrating drops to a
// single repeat as soon as one call is slow.
const TARGET_SAMPLE_MS = 60;

const repeatsFor = (body: string): number => {
  parseWikiPage("x.md", body); // warm up: keep JIT cost out of the estimate
  const started = performance.now();
  parseWikiPage("x.md", body);
  const one = performance.now() - started;
  return Math.max(1, Math.round(TARGET_SAMPLE_MS / Math.max(one, 0.05)));
};

const sample = (body: string, repeats: number): number => {
  const started = performance.now();
  for (let i = 0; i < repeats; i += 1) parseWikiPage("x.md", body);
  return performance.now() - started;
};

const growthRatio = (shape: (size: number) => string): number => {
  const small = shape(HALF_PAGE_SIZE);
  const large = shape(PAGE_SIZE);
  const repeats = repeatsFor(small);
  let best = Number.POSITIVE_INFINITY;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    best = Math.min(best, sample(large, repeats) / sample(small, repeats));
  }
  return best;
};

// Only a `]`-free run of `[` fires this. Any `]` truncates the backtrack tail,
// which is why real markdown is safe: 32 KB of prose carrying real `[[link]]`s
// cost 1.1 ms on the unfixed build, and the longest `[` run anywhere in the real
// wiki is 2. Both shapes below are therefore self-inflicted, not
// attacker-supplied — the walkers skip wiki/raw/, the only external-ingest
// folder.
const SHAPES: ReadonlyArray<readonly [string, (size: number) => string]> = [
  ["a bare run of `[`", (size) => `# t\n\n${"[".repeat(size)}\n`],
  ["a run of `[[` markers", (size) => `# t\n\n${"[[".repeat(size / 2)}\n`],
];

describe("parseWikiPage — wikilink ReDoS regression", () => {
  for (const [label, shape] of SHAPES) {
    it(`grows no worse than ${MAX_GROWTH}x from ${HALF_PAGE_SIZE / 1000} KB to ${
      PAGE_SIZE / 1000
    } KB of ${label}`, () => {
      expect(growthRatio(shape)).toBeLessThan(MAX_GROWTH);
    });
  }
});

describe("wikilink extraction unchanged after excluding `[` from the target class", () => {
  const cases: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ["a plain link", "see [[concepts/foo]] here", ["concepts/foo"]],
    ["an aliased link", "see [[concepts/foo|Foo]] here", ["concepts/foo"]],
    ["an anchored link", "see [[bar#sec]] here", ["bar"]],
    ["two links on one line", "[[a]] and [[b]]", ["a", "b"]],
    ["an unterminated link", "see [[concepts/foo and nothing else", []],
    ["a bracketed markdown link", "see [text](http://x/y) here", []],
    ["an empty link", "see [[]] here", []],
  ];

  for (const [label, body, expected] of cases) {
    it(`extracts the same links from ${label}`, () => {
      expect(parseWikiPage("x.md", body).links).toEqual(expected);
    });
  }

  // The one deliberate divergence, pinned so it is a decision and not a
  // surprise: `[` is no longer accepted inside a link target. Obsidian targets
  // cannot contain `[` either, so this drops nothing real — and on the nested
  // form it is strictly more correct, since the innermost `[[` is the link.
  it("no longer swallows a `[` inside the link target", () => {
    expect(parseWikiPage("x.md", "see [[a[b]] here").links).toEqual([]);
  });

  it("resolves a triple-bracket link to the innermost marker", () => {
    expect(parseWikiPage("x.md", "see [[[a]] here").links).toEqual(["a"]);
  });
});
