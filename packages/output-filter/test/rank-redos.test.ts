import { describe, expect, it } from "vitest";
import { collapseSimilar } from "../src/normalize.js";
import { detectStacktrace } from "../src/parsers/stacktrace.js";
import { type Chunk, scoreChunk } from "../src/rank.js";

const chunk = (text: string): Chunk => ({ text, startLine: 1, endLine: 1 });

// Five signal patterns across this package pair a greedy run with a required
// trailing literal. Unbounded, every position in a run the class accepts starts
// a scan to end-of-input that then fails the literal and backtracks —
// O(starts x length). Each timing block below drives exactly ONE of them
// through its real call site, and each was verified to go red on its own when
// that single bound is reverted (16.1 / 19.3 / 32.9 / 16.5 / 12.2 s).
//
// The bounds are what make these linear. Do not "simplify" the {0,N}/{1,N}
// quantifiers back to * or +: real exception names, file paths, source
// positions and stack frames are short, but arbitrary tool output routinely
// carries long delimiter-free runs (base64 blobs, minified bundles, hex dumps)
// and long whitespace runs (column-padded tables, tab-indented logs).
//
// On SIZE: 100 KB, not 50 KB, because 50 KB does not separate the two forms.
// The defect is quadratic and the fix linear, so doubling the input quadruples
// the unbounded cost and only doubles the bounded one. At 50 KB four of the
// five reverted patterns cost 2.9-4.7 s — under the ceiling, silently green. At
// 100 KB the cheapest reversion costs 12.2 s. Do not lower SIZE.
//
// On the ceiling: 5 s is deliberately loose. All 20 tests here together run in
// ~450 ms, so there is wide headroom for a loaded runner (this suite runs under
// `turbo test` with ~12 packages in parallel, where a 1 s ceiling did flake),
// while the cheapest reversion still fails by 2.4x. This catches the
// catastrophic regression that motivated the bounds. It does NOT catch a modest
// slowdown — the signal-detection assertions below, and the bounds themselves
// being visible in the source, are what guard the rest.
//
// A scaling-ratio assertion was tried first and rejected: measured over 12 runs
// the bounded ratio ranged 1.48-3.78 while an unbounded run measured 1.81, so it
// did not separate the two.
const CEILING_MS = 5_000;
const SIZE = 100_000;

const elapsed = (run: () => void): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

describe("scoreChunk — ReDoS regression on long runs", () => {
  // 'X' is in [A-Z], [A-Za-z] and [\w./-] at once, so a run of it drives both
  // EXCEPTION_NAME (16.1 s reverted) and FILE_PATH (18.9 s reverted). It does
  // NOT reach POSITION — that pattern lives in normalize.ts, which scoreChunk
  // never calls; its driver is the collapseSimilar block below.
  it(`scores ${SIZE / 1000} KB of a single repeated character under ${CEILING_MS} ms`, () => {
    expect(elapsed(() => scoreChunk(undefined, chunk("X".repeat(SIZE))))).toBeLessThan(CEILING_MS);
  });

  // '/' and '-' are in [\w./-] but not [A-Za-z], so this shape drives FILE_PATH
  // alone — a fix that only bounded EXCEPTION_NAME still fails here (19.3 s
  // reverted). It is also realistic: path-like text with no whitespace.
  it(`scores ${SIZE / 1000} KB of a delimiter-free path-ish run under ${CEILING_MS} ms`, () => {
    expect(elapsed(() => scoreChunk(undefined, chunk("a/b-c".repeat(SIZE / 5))))).toBeLessThan(
      CEILING_MS,
    );
  });

  // STACKTRACE's driver is different: `\s+` and `.+` BOTH accept whitespace, so
  // the split between them is ambiguous at every offset of a long whitespace
  // run. The trailing 'x' matters — `normalize` strips trailing whitespace, so
  // only a run with something after it survives to the scorer. 32.9 s reverted.
  it(`scores a ${SIZE / 1000} KB whitespace run inside a frame under ${CEILING_MS} ms`, () => {
    expect(elapsed(() => scoreChunk(undefined, chunk(`  at ${" ".repeat(SIZE)}x`)))).toBeLessThan(
      CEILING_MS,
    );
  });
});

describe("detectStacktrace — ReDoS regression on paren-dense lines", () => {
  // SIGNATURE's two `.+` runs are quadratic on a line dense in '(' — every
  // offset that could be the `\(` re-scans the rest. detectStacktrace runs
  // SIGNATURE against the WHOLE normalized document, so one such line is
  // enough: 16.5 s reverted.
  it(`scans ${SIZE / 1000} KB of a paren run under ${CEILING_MS} ms`, () => {
    expect(elapsed(() => detectStacktrace(`  at ${"(".repeat(SIZE)}`))).toBeLessThan(CEILING_MS);
  });
});

describe("collapseSimilar — ReDoS regression via POSITION", () => {
  // POSITION lives in normalize.ts and is NOT reachable from scoreChunk, so it
  // needs its own driver: collapseSimilar tests every line against it. Reverting
  // POSITION alone to `[\w./-]*` — and nothing else — takes this to 12.2 s.
  it(`folds a ${SIZE / 1000} KB delimiter-free line under ${CEILING_MS} ms`, () => {
    expect(elapsed(() => collapseSimilar("a/b-c".repeat(SIZE / 5)))).toBeLessThan(CEILING_MS);
  });
});

describe("signals still detected after bounding", () => {
  const cases: ReadonlyArray<
    readonly [string, string, keyof ReturnType<typeof scoreChunk>["features"], number]
  > = [
    ["a bare exception name", "ZeroDivisionError: division by zero", "errorScore", 4],
    ["an embedded camelCase exception", "caught a handleTypeError in the loop", "errorScore", 4],
    [
      "a stack frame with a rooted path",
      "  at f (/src/app/handler.ts:42:17)",
      "stackTraceScore",
      3,
    ],
    ["a paren-less stack frame", "  at /srv/app/index.js:9:3", "stackTraceScore", 3],
    ["a tab-indented stack frame", "\tat foo (/a/b.js:3:4)", "stackTraceScore", 3],
    ["a deep monorepo frame", `  at f (${"/pkg".repeat(30)}/x.ts:1:2)`, "stackTraceScore", 3],
    ["a plain file path", "config at packages/core/src/thing.json", "filePathScore", 1],
    // A Java frame carries only :line, never :line:col — it did not score before
    // the bounds either, and must not start scoring now.
    ["a Java frame", "\tat com.example.Foo.bar(Foo.java:42)", "stackTraceScore", 0],
    ["a Python traceback line", '  File "/x/y.py", line 3, in <module>', "stackTraceScore", 0],
  ];

  for (const [label, text, feature, expected] of cases) {
    it(`${expected > 0 ? "still scores" : "still ignores"} ${label}`, () => {
      expect(scoreChunk(undefined, chunk(text)).features[feature]).toBe(expected);
    });
  }

  // SIGNATURE is stricter than STACKTRACE: it requires the parenthesized form,
  // so the paren-less frame is a deliberate rejection, not a bounding casualty.
  const detected: ReadonlyArray<readonly [string, string, boolean]> = [
    ["node frame with parens", "    at foo (/src/app/handler.ts:42:17)", true],
    ["node internal frame", "    at M._compile (node:internal/modules/cjs/loader:1105:14)", true],
    ["nested v8 eval frame", "    at eval (eval at <a> (/a/b.js:1:1), <anonymous>:1:1)", true],
    ["paren-less node frame", "    at /srv/app/index.js:9:3", false],
    ["java frame", "\tat com.example.Foo.bar(Foo.java:42)", false],
    ["python traceback header", "Traceback (most recent call last):", false],
  ];

  for (const [label, text, expected] of detected) {
    it(`${expected ? "detects" : "rejects"} ${label}`, () => {
      expect(detectStacktrace(text)).toBe(expected);
    });
  }
});
