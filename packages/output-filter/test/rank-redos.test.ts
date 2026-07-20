import { describe, expect, it } from "vitest";
import { type Chunk, scoreChunk } from "../src/rank.js";

const chunk = (text: string): Chunk => ({ text, startLine: 1, endLine: 1 });

// scoreChunk's signal patterns pair a greedy run with a required trailing
// literal. Unbounded, every position in a long run the class accepts starts a
// scan to end-of-input that then fails the literal and backtracks —
// O(starts x length). 'X' is in [A-Z], [A-Za-z] and [\w./-] at once, so a run of
// it hits EXCEPTION_NAME, FILE_PATH and POSITION together: 6.6 s, 8.1 s and
// 7.4 s on 50 KB before the bounds were added, ~22 s combined.
//
// The bounds are what make this linear. Do not "simplify" the {0,N}/{1,N}
// quantifiers back to * or +: real exception names, file paths and source
// positions are short, but arbitrary tool output routinely carries long
// delimiter-free runs (base64 blobs, minified bundles, hex dumps).
//
// On the ceiling: 5 s is deliberately loose. Bounded costs ~300 ms here, so
// there is ~16x headroom for a loaded runner (this suite runs under `turbo test`
// with ~12 packages in parallel, where a 1 s ceiling did flake); the unbounded
// form costs ~22 s, so it still fails by ~4x. This catches the catastrophic
// regression that motivated the bounds. It does NOT catch a modest slowdown —
// the four signal-detection assertions below, and the bounds themselves being
// visible in the source, are what guard the rest.
//
// A scaling-ratio assertion was tried first and rejected: measured over 12 runs
// the bounded ratio ranged 1.48-3.78 while an unbounded run measured 1.81, so it
// did not separate the two.
const CEILING_MS = 5_000;
const SIZE = 50_000;

describe("scoreChunk — ReDoS regression on delimiter-free runs", () => {
  it(`scores ${SIZE / 1000} KB of a single repeated character under ${CEILING_MS} ms`, () => {
    const started = performance.now();
    scoreChunk(undefined, chunk("X".repeat(SIZE)));
    expect(performance.now() - started).toBeLessThan(CEILING_MS);
  });

  // '/' and '.' are in [\w./-] but not [A-Za-z], so this shape targets FILE_PATH
  // and POSITION specifically — a fix that only bounded EXCEPTION_NAME still
  // fails here. It is also realistic: path-like text with no whitespace.
  it(`scores ${SIZE / 1000} KB of a delimiter-free path-ish run under ${CEILING_MS} ms`, () => {
    const started = performance.now();
    scoreChunk(undefined, chunk("a/b-c".repeat(SIZE / 5)));
    expect(performance.now() - started).toBeLessThan(CEILING_MS);
  });
});

describe("scoreChunk — signals still detected after bounding", () => {
  const cases: ReadonlyArray<
    readonly [string, string, keyof ReturnType<typeof scoreChunk>["features"]]
  > = [
    ["a bare exception name", "ZeroDivisionError: division by zero", "errorScore"],
    ["an embedded camelCase exception", "caught a handleTypeError in the loop", "errorScore"],
    ["a stack frame with a rooted path", "  at foo (/src/app/handler.ts:42:17)", "stackTraceScore"],
    ["a plain file path", "config at packages/core/src/thing.json", "filePathScore"],
  ];

  for (const [label, text, feature] of cases) {
    it(`still scores ${label}`, () => {
      expect(scoreChunk(undefined, chunk(text)).features[feature]).toBeGreaterThan(0);
    });
  }
});
