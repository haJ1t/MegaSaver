import { describe, expect, it } from "vitest";
import { extractFailureSignatures } from "../src/session-hints.js";

// FILE_PATH in session-hints.ts is the twin of the FILE_PATH bounded in
// packages/output-filter/src/rank.ts (`4ddac04e`). This copy was missed, and it
// is the WORSE form: `[\w./\\-]*\w+\.` puts two unbounded runs over overlapping
// classes back to back (`\w` is a subset of `[\w./\\-]`), so the split between
// them is ambiguous at every offset — superquadratic, not quadratic. Measured
// through extractFailureSignatures on a run of `x`: 1.2 s at 2 KB, 9.1 s at
// 4 KB, 80.5 s at 8 KB (~7-8x per doubling, i.e. ~n^3).
//
// 4 KB is not an arbitrary probe size — it is the SHIPPED cap. Both capture
// sites slice every stored record to exactly 4000 chars
// (run-command.ts:305 and :574, `redact(...).redacted.slice(0, 4000)`), so the
// cap IS the worst case, and it is persisted: MAX_OVERLAY_FAILURES=50 records
// are re-extracted by buildSessionHints / buildOverlayHints on every read and
// exec (run.ts:134, run.ts:315, run-command.ts:251, run-command.ts:522, and the
// guard-run hook at apps/cli/src/hooks/guard-run.ts:196). One poisoned session
// adds minutes of CPU to every later tool call, permanently.
const SHIPPED_CAP = 4_000;

// Why an absolute ceiling and not a growth ratio: re-measured at the cap here,
// bounded costs 1.9-2.1 ms per call and the reverted pattern costs 15-22 s
// across runs — a ~6000x separation. (The 9.1 s above is the original
// reporter's machine; the defect is the same, the hardware is not. That spread
// is itself the argument: an absolute number this far from both outcomes does
// not care which machine it lands on, and a 2.5x ratio does.) A ceiling placed
// anywhere in that gap is decided by the defect, not by the runner.
//
// The growth-ratio guard this replaces asserted `< 2.5x` from 2 KB to 4 KB off
// ~60 ms samples. Bounded measures ~2.0x there, so the whole gate lived inside
// a 25% band, and on windows-latest it measured 4.12x and went red on a commit
// that had passed an hour earlier. A security regression test that cries wolf
// is worse than none: it trains everyone to re-run without reading, which is
// exactly how the real regression would get waved through.
//
// The prior-art objection to ceilings — "a ceiling only guards what it
// separates" — does not apply at this separation. There the reverted forms were
// genuinely fast at the size probed; here every shape is 5000x+ over the
// ceiling with the bound reverted, and the numbers above are per-shape
// measurements, not an extrapolation. Prior art cuts the other way too: the
// sibling suite in packages/output-filter/test/rank-redos.test.ts tried a
// scaling ratio FIRST and rejected it, measuring the bounded ratio at 1.48-3.78
// over 12 runs. A 2.5x threshold sits inside that band. Both siblings
// (rank-redos, policy/glob-redos) settled on a ceiling; this file was the
// outlier, and windows-latest found the seam.
//
// 1 s is placed against the TAIL, not the median: bounded runs 1.9-2.1 ms
// typically, but a cold first call was observed at 73.8 ms and warm calls spike
// to 12-21 ms under load, so the honest green margin is ~13x here and ~4x on a
// windows-latest runner (~3x slower at this workload). `retry: 3` covers what
// is left — with a 6000x separation a retry cannot mask a real regression,
// since a reverted bound is 12-22 s on every attempt.
//
// The narrowest case is NOT the full revert. Restoring just the `+`
// (`{0,255}\w+\.`, keeping the outer bound) costs 1.9-3.0 s — only ~2-3x over
// the ceiling, which a much faster future machine could close. That case does
// not rest on the ceiling: it also fails the 256-char clip assertion at the
// bottom of this file, in 2 ms, deterministically and independent of hardware.
// The two halves of this file are a pair — the clip assertion pins the bound so
// the only bound-preserving regression left is the `+` restore, and that one is
// caught without a stopwatch. Neither half is sufficient alone.
const CEILING_MS = 1_000;

// Same shape as the sibling suites' helper, deliberately. One call, no
// calibration loop and no repeat count: the old sampler needed both because it
// compared two sizes and had to keep samples long enough to out-measure noise,
// and a ceiling this far from either outcome needs neither. One call also keeps
// the RED path honest — a reverted bound fails on the ceiling in ~20 s per shape
// and reports the real measurement, instead of running a repeat loop vitest
// cannot interrupt (its `timeout` only fires at async boundaries) and surfacing
// as a timeout with no number in it.
const elapsed = (run: () => void): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

// All three shapes are runs of characters that `\w` and `[\w./\\-]` BOTH accept —
// that overlap is the whole defect. A path-ish run (`a/b-c`) does NOT trigger
// it: `/` and `-` are outside `\w`, so the second run cannot extend and the
// ambiguity collapses (19.5 ms unfixed). Neither does a real base64 blob or an
// npm `sha512-` integrity hash — `+` and `=` break the run.
const SHAPES: ReadonlyArray<readonly [string, (size: number) => string]> = [
  // The report's repro, and the pure form of the defect: 17-20 s unfixed at the cap.
  ["a single repeated character", (size) => "x".repeat(size)],
  // Accidental, not crafted: a 4 KB hex dump costs 15-19 s unfixed. Interleaving
  // letters and digits changes nothing — both are `\w`.
  ["a hex-dump run", (size) => "a1b2c3d4".repeat(size / 8)],
  // Underscores and digits are `\w` too, so identifier-ish dumps trigger it
  // just as well (17-22 s unfixed at the cap).
  ["an underscore/digit run", (size) => "a_1__b2_".repeat(size / 8)],
];

describe("extractFailureSignatures — ReDoS regression at the shipped 4000-char cap", () => {
  for (const [label, shape] of SHAPES) {
    it(
      `scans ${SHIPPED_CAP / 1000} KB of ${label} in under ${CEILING_MS / 1000}s`,
      { retry: 3 },
      () => {
        const input = shape(SHIPPED_CAP);

        expect(elapsed(() => extractFailureSignatures(input))).toBeLessThan(CEILING_MS);
      },
    );
  }
});

describe("signatures unchanged after bounding", () => {
  const cases: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    [
      "a tsc caret diagnostic",
      "src/auth.ts:42:10 - error TS2322: Type mismatch.",
      ["TS2322", "src/auth.ts:42", "src/auth.ts"],
    ],
    [
      "a tsc parenthesised diagnostic",
      "packages/context-gate/src/session-hints.ts(17,7): error TS6133: unused.",
      ["TS6133", "packages/context-gate/src/session-hints.ts"],
    ],
    [
      "a node stack frame",
      "    at f (/Users/x/repo/packages/core/src/thing.ts:42:17)",
      ["/Users/x/repo/packages/core/src/thing.ts:42", "/Users/x/repo/packages/core/src/thing.ts"],
    ],
    [
      "a Windows backslash path",
      "C:\\Users\\dev\\repo\\src\\app\\main.ts:88:3 - error TS2554",
      [
        "TS2554",
        "\\Users\\dev\\repo\\src\\app\\main.ts:88",
        "\\Users\\dev\\repo\\src\\app\\main.ts",
      ],
    ],
    [
      "a Windows relative path",
      "..\\..\\shared\\types.d.ts:9:1",
      ["..\\..\\shared\\types.d.ts:9", "..\\..\\shared\\types.d.ts"],
    ],
    [
      "a rustc diagnostic",
      "error[E0308]: mismatched types --> src/lib.rs:10:5",
      ["E0308", "src/lib.rs:10", "src/lib.rs"],
    ],
    [
      "a vitest FAIL line",
      "FAIL packages/output-filter/test/rank-redos.test.ts > scoreChunk",
      ["packages/output-filter/test/rank-redos.test.ts"],
    ],
    [
      "a python traceback line",
      'File "/srv/app/handlers/view.py", line 33, in <module>',
      ["/srv/app/handlers/view.py"],
    ],
    ["a java frame", "\tat com.example.Foo.bar(Foo.java:42)", ["Foo.java:42", "Foo.java"]],
    ["a go vet line", "go: src/main.go:14:2: undefined: foo", ["src/main.go:14", "src/main.go"]],
    // README.md/example.com are prose and hostnames, not failure locations —
    // hasCodeExtension already rejected them and must keep doing so.
    ["prose dot-tokens", "see README.md and example.com for details", []],
    [
      "a deep monorepo path",
      `  at deep (${"/pkg".repeat(30)}/x.ts:1:2)`,
      [`${"/pkg".repeat(30)}/x.ts:1`, `${"/pkg".repeat(30)}/x.ts`],
    ],
  ];

  for (const [label, input, expected] of cases) {
    it(`extracts the same signatures from ${label}`, () => {
      expect(extractFailureSignatures(input)).toEqual(expected);
    });
  }

  // The one deliberate divergence from the unbounded form, pinned so it is a
  // decision and not a surprise: the leading run is capped at 256 chars
  // (`{0,255}` plus the single required `\w`), so a path whose head exceeds that
  // yields a clipped signature instead of the whole token. A clipped path is
  // still a substring of the later output it should boost, and real paths are
  // nowhere near this long — the deep-monorepo case above is 125 chars. Same
  // trade the merged output-filter twin makes with `{1,256}`.
  it("clips the leading run of an absurdly long path instead of scanning it whole", () => {
    const [signature] = extractFailureSignatures(`${"x".repeat(300)}.ts`);

    expect(signature).toBe(`${"x".repeat(256)}.ts`);
  });
});
