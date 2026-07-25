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
// The ratio is taken from half the cap up to the cap, so the largest input the
// assertion drives is exactly the 4000 chars the capture sites store. Going up
// to 8 KB instead would guard nothing extra — nothing stores 8 KB — and would
// cost 80 s per sample once a bound is reverted.
const HALF_CAP = SHIPPED_CAP / 2;

// Why a growth RATIO and not a wall-clock ceiling: a ceiling only guards what it
// separates, and on a fast idle runner a reverted bound can slip under it — the
// prior-art suite documents four of five reverted bounds passing silently under
// a 5 s ceiling at 50 KB. The ratio is runtime- and load-independent: bounded is
// linear (~2.0x per doubling), while the unbounded form measured 5.4-5.7x here
// under this exact sampler. That same prior-art suite tried a ratio and rejected
// it, but there the unbounded form measured only 1.81x at the sizes used, so it
// never separated. Here it clears the 2.5x threshold by >2x in the red direction
// and sits ~20% under it in the green direction, which is what makes the ratio
// the better guard.
//
// min-of-TRIALS, not mean: scheduler noise can only ever INFLATE a measured
// duration, so a spike in the cap sample inflates that trial's ratio and a spike
// in the half-cap sample deflates it. Taking the minimum discards the inflated
// trials and can only make the assertion harder to pass, never easier. A single
// un-minimised trial reached 2.91x under four busy cores; the min over 5 trials
// stayed at 1.09-1.94x both idle and loaded.
const MAX_GROWTH = 2.5;
const TRIALS = 5;

// Sample count is calibrated per shape rather than fixed, and that is what makes
// this test fail FAST when a bound is reverted. Vitest cannot interrupt a
// synchronous loop — its `timeout` only fires at async boundaries — so a fixed
// repeat count would multiply the unbounded 9.1 s cap-size call by that count
// and hang for 17+ minutes instead of going red. Calibrating against one real
// call spends ~60 ms per sample when the pattern is bounded (≈55 repeats) and
// drops to a single repeat when it is not, so a reverted bound reds out in ~50 s
// on the ratio itself, not on a timeout.
const TARGET_SAMPLE_MS = 60;

const repeatsFor = (input: string): number => {
  extractFailureSignatures(input); // warm up: keep JIT cost out of the estimate
  const started = performance.now();
  extractFailureSignatures(input);
  const one = performance.now() - started;
  return Math.max(1, Math.round(TARGET_SAMPLE_MS / Math.max(one, 0.05)));
};

const sample = (input: string, repeats: number): number => {
  const started = performance.now();
  for (let i = 0; i < repeats; i += 1) extractFailureSignatures(input);
  return performance.now() - started;
};

const growthRatio = (shape: (size: number) => string): number => {
  const small = shape(HALF_CAP);
  const large = shape(SHIPPED_CAP);
  const repeats = repeatsFor(small);
  let best = Number.POSITIVE_INFINITY;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    best = Math.min(best, sample(large, repeats) / sample(small, repeats));
  }
  return best;
};

// All three shapes are runs of characters that `\w` and `[\w./\\-]` BOTH accept —
// that overlap is the whole defect. A path-ish run (`a/b-c`) does NOT trigger
// it: `/` and `-` are outside `\w`, so the second run cannot extend and the
// ambiguity collapses (19.5 ms unfixed). Neither does a real base64 blob or an
// npm `sha512-` integrity hash — `+` and `=` break the run.
const SHAPES: ReadonlyArray<readonly [string, (size: number) => string]> = [
  // The report's repro, and the pure form of the defect: 9.1 s unfixed at the cap.
  ["a single repeated character", (size) => "x".repeat(size)],
  // Accidental, not crafted: a 4 KB hex dump costs 11.4 s unfixed. Interleaving
  // letters and digits changes nothing — both are `\w`.
  ["a hex-dump run", (size) => "a1b2c3d4".repeat(size / 8)],
  // Underscores and digits are `\w` too, so identifier-ish dumps trigger it
  // just as well (10.1 s unfixed at the cap).
  ["an underscore/digit run", (size) => "a_1__b2_".repeat(size / 8)],
];

describe("extractFailureSignatures — ReDoS regression at the shipped 4000-char cap", () => {
  for (const [label, shape] of SHAPES) {
    it(`grows no worse than ${MAX_GROWTH}x from ${HALF_CAP / 1000} KB to ${
      SHIPPED_CAP / 1000
    } KB of ${label}`, () => {
      expect(growthRatio(shape)).toBeLessThan(MAX_GROWTH);
    });
  }
});

// The bound must not change which signatures come out. Every expectation below
// was captured from the UNBOUNDED pattern before the fix, so these lock
// behaviour rather than describe it: they pass identically before and after.
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
