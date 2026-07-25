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
// 200 KB, not the 32 KB real-page size the shapes were first measured at: the
// gate is an absolute ceiling now, and a ceiling is only as good as the
// separation it sits in. The growth-ratio gate this file used to carry was
// abandoned across this suite after the sibling anchor-strip test read 15.9x
// under a 55-task parallel `turbo` run while measuring 2-4x idle — sustained
// load inflates the large sample more than the small one, and min-of-trials
// cannot cancel that when every trial is slow. Matches the instrument the
// context-gate suite moved to in 0e8f3362 (#301).
const PAGE_SIZE = 200_000;

// Measured at PAGE_SIZE, one call, this machine: bounded 0.1-0.2 ms on both
// shapes; the reverted `[^\]]+` costs 15,600 ms (`[` run) and 15,500 ms (`[[`
// run). The ceiling sits 62x below the cheapest red and ~1,250x above the most
// expensive green.
const CEILING_MS = 250;

// The reverted form needs ~16 s per shape, so the per-test budget must clear it:
// the assertion, not a timeout, is what fails on a revert.
const TIMEOUT_MS = 240_000;

const elapsed = (body: string): number => {
  parseWikiPage("x.md", body); // warm up: keep JIT cost out of the sample
  const started = performance.now();
  parseWikiPage("x.md", body);
  return performance.now() - started;
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
    it(
      `scans ${PAGE_SIZE / 1000} KB of ${label} in under ${CEILING_MS} ms`,
      () => {
        expect(elapsed(shape(PAGE_SIZE))).toBeLessThan(CEILING_MS);
      },
      TIMEOUT_MS,
    );
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
