import { describe, expect, it } from "vitest";
import {
  MATCH_OVERHEAD_BYTES,
  MAX_WORK_UNITS,
  countTokens,
  tokenWorkUnits,
} from "../src/tokens.js";

const repeat = (unit: string, n: number): string =>
  unit.repeat(Math.ceil(n / unit.length)).slice(0, n);

const CLEAN_LOG_50K = repeat("2026-08-05 INFO handled request id=abc123 in 42ms\n", 50_000);

// Spec §8. `measured: true` means the shape MUST be counted, `false` that it
// MUST be declined — asserted either way, so a fixture cannot go quiet by
// starting to decline.
//
// The HETERO entries are the ones that matter most: every other fixture is
// repeat(unit, n) and therefore homogeneous, which is exactly the shape an
// estimator built on a global maximum cannot get wrong. A real 50 KB log with
// one embedded base64 line is the case that a max-times-total form scored at
// 22.7x budget and refused, though it encodes in ~32 ms.
const FIXTURES: ReadonlyArray<{ id: string; text: string; measured: boolean }> = [
  {
    id: "PROSE",
    text: repeat("The quick brown fox jumps over the lazy dog. ", 20_000),
    measured: true,
  },
  {
    id: "TS",
    text: repeat("export function foo(bar: string): number { return bar.length; }\n", 20_000),
    measured: true,
  },
  { id: "JSON_MIN", text: repeat('{"a":1,"bb":22,"ccc":333},', 20_000), measured: true },
  // ~30 KB is the ceiling for punctuated CJK: three bytes per character
  // makes every match three times the work of its ASCII equivalent.
  {
    id: "JA",
    text: repeat("日本語のテキストです。処理速度を測定しています。", 9_000),
    measured: true,
  },
  { id: "NFD", text: repeat("éééé ", 20_000), measured: true },
  { id: "B64_WRAPPED", text: repeat(`${repeat("aGVsbG8gd29ybGQ", 76)}\n`, 20_000), measured: true },
  { id: "HETERO_ONE_B64_LINE", text: `${CLEAN_LOG_50K}${"A".repeat(800)}\n`, measured: true },
  { id: "HETERO_LONG_B64_LINE", text: `${CLEAN_LOG_50K}${"B".repeat(2000)}\n`, measured: false },
  { id: "RULE_1500", text: repeat(`${"=".repeat(1500)}\n`, 20_000), measured: false },
  { id: "BOX_64", text: repeat(`${"═".repeat(64)}\n`, 20_000), measured: false },
  { id: "SPACES", text: repeat(" ", 32_768), measured: false },
  { id: "NEWLINES", text: repeat("\n", 32_768), measured: false },
  // High-match-count and cheap per byte, but the per-match floor is what makes
  // them finite: 240 KB is the ceiling, and 400 KB is over it. An estimator
  // without the floor admits these at megabytes, where they are not cheap.
  { id: "XLF", text: repeat("x\n", 200_000), measured: true },
  { id: "XLF_OVER", text: repeat("x\n", 400_000), measured: false },
  { id: "A1", text: repeat("a1", 200_000), measured: true },
];

const loadEncoding = async () => {
  const { getEncoding } = await import("js-tiktoken");
  return getEncoding("cl100k_base");
};

// The operator's ceiling for one tool call. record-output runs two counters,
// both synchronous, plus a lazy load and two scans — see MAX_WORK_UNITS for
// the full derivation and for what the bound does and does not guarantee.
const TOOL_CALL_CEILING_MS = 1500;

describe("countTokens decides every fixture the way the table says", () => {
  it.each(FIXTURES)("$id is $measured", async ({ text, measured }) => {
    const count = await countTokens(text);
    expect(count === null).toBe(!measured);
  });

  // The headline property. Nothing is chunked, so a measured count is the
  // encoder's own output and any difference at all is a bug.
  it.each(FIXTURES.filter((f) => f.measured))("$id is exact", async ({ text }) => {
    const encoding = await loadEncoding();
    expect(await countTokens(text)).toBe(encoding.encode(text).length);
  });

  // The contract is the WORK bound, and work is a pure function of the input —
  // so this is what every fixture asserts. An absolute wall-clock assertion per
  // fixture is not sound here: under a parallel `turbo test` the 60 KB Japanese
  // fixture measured 1,119 ms against ~125 ms idle, which is contention, not a
  // regression.
  it.each(FIXTURES)(
    "$id is within the work budget iff it is measured",
    async ({ text, measured }) => {
      const work = await tokenWorkUnits(text);
      // null means the length pre-check refused to scan it, which is over
      // budget by construction rather than by measurement.
      const withinBudget = work !== null && work <= MAX_WORK_UNITS;
      expect(withinBudget).toBe(measured);
    },
  );
});

describe("the work budget is calibrated to the time budget", () => {
  // The one timing claim, and deliberately loose. Per-fixture wall-clock is
  // unusable under a parallel `turbo test` — the Japanese fixture measured
  // 1,119 ms against ~125 ms idle — and a ratio against a cheap reference is
  // worse, since the reference encodes in 1–2 ms and the denominator becomes
  // measurement noise. A framework timeout is worse still: it is a setTimeout
  // and cannot interrupt a synchronous encode, so a 70-second call once
  // reported green under a 5-second timeout.
  //
  // What this catches is the failure that matters: a guard that stopped
  // bounding the encode. The unguarded cases in this suite take 24–114
  // SECONDS, so a 5x-budget ceiling separates them from contention by two
  // orders of magnitude while never failing on load.
  //
  // `retry: 3` matches the repo's other CI timing guards (policy/glob-redos,
  // output-filter/dedupe-quadratic, policy/redact-jwt). It is carried here from
  // the commit this file's rewrite conflicted with: ubuntu-latest measured
  // 10,358–12,212 ms on a guard that runs ~1 s locally, consistently across all
  // four attempts — a systematic shared-runner slowdown rather than a flake.
  // This fixture encodes in ~50 ms locally, so even a 10x runner stays two
  // orders of magnitude below the ceiling; the retry is insurance, not a
  // substitute for the margin.
  it(
    "encodes the worst admitted fixture nowhere near the unguarded cost",
    { retry: 3, timeout: 30_000 },
    async () => {
      const worst = repeat("日本語のテキストです。処理速度を測定しています。", 9_000);
      await countTokens("warm the encoding");

      const started = Date.now();
      expect(await countTokens(worst)).not.toBeNull();
      expect(Date.now() - started).toBeLessThan(TOOL_CALL_CEILING_MS * 3);
    },
  );

  // Two-sided. A one-sided bound with 3x slack cannot fail until the constant
  // triples, which makes calibration drift undetectable — the previous version
  // of this test had exactly that hole.
  it("keeps the budget's own derivation honest", () => {
    const K_IDLE_MAX_US = 0.0478;
    const LOAD_MS = 98;
    const SCAN_MS = 66;
    const COUNTERS = 2;
    const CONTENTION = 4.3;

    const idleEventMs =
      (COUNTERS * (MAX_WORK_UNITS * K_IDLE_MAX_US)) / 1000 + LOAD_MS + COUNTERS * SCAN_MS;
    // Holds the operator ceiling at the contention the derivation assumes...
    expect(idleEventMs * CONTENTION).toBeLessThanOrEqual(TOOL_CALL_CEILING_MS);
    // ...and is not so conservative that it has silently stopped measuring
    // anything: half the ceiling would mean the budget could safely double.
    expect(idleEventMs * CONTENTION).toBeGreaterThan(TOOL_CALL_CEILING_MS / 2);
  });
});

describe("heterogeneous input is not poisoned by one outlier match", () => {
  // The defect a global-maximum estimator has and a per-match sum does not: one
  // long line contaminating every unrelated byte in the document.
  it("measures a clean log that contains a single long unbroken line", async () => {
    const withOutlier = `${CLEAN_LOG_50K}${"A".repeat(800)}\n`;
    expect(await countTokens(CLEAN_LOG_50K)).not.toBeNull();
    expect(await countTokens(withOutlier)).not.toBeNull();
  });

  it("charges the outlier for itself, not for the whole document", async () => {
    const clean = (await tokenWorkUnits(CLEAN_LOG_50K)) ?? 0;
    const withOutlier = (await tokenWorkUnits(`${CLEAN_LOG_50K}${"A".repeat(800)}\n`)) ?? 0;
    // One 800-byte match adds (4+800)*800 = 643,200 and nothing more. A
    // max-times-total form would multiply the whole 50 KB by 804 instead.
    expect(withOutlier - clean).toBeLessThan(700_000);
  });
});

describe("the work computation itself", () => {
  // Asserted directly rather than inferred from a stopwatch. Measuring match
  // length in UTF-16 code units instead of UTF-8 bytes under-counts multi-byte
  // content 3x, and a timing assertion misses it because the mutant's admitted
  // sizes still encode under budget on the fixtures that use it.
  it("measures match length in UTF-8 bytes, not code units", async () => {
    const box = repeat(`${"═".repeat(200)}\n`, 20_000);
    expect(await tokenWorkUnits(box)).toBeGreaterThan(MAX_WORK_UNITS * 3);
    expect(await countTokens(box)).toBeNull();
  });

  // Boundary for the comparison operator: `>=` declines this, `>` admits it.
  // "a"x1093 contributes (4+1093)*1093 = 1,199,021; the pad adds 2x32 + 3x21 +
  // 71x12 = 979, landing exactly on the budget.
  const AT_BUDGET = `${"a".repeat(1093)}${" abc".repeat(2)}${" ab".repeat(3)}${" a".repeat(71)}`;

  it("admits work exactly equal to the budget", async () => {
    expect(await tokenWorkUnits(AT_BUDGET)).toBe(MAX_WORK_UNITS);
    expect(await countTokens(AT_BUDGET)).not.toBeNull();
  });

  it("declines one match past the budget", async () => {
    const overBudget = `${AT_BUDGET} a`;
    expect(await tokenWorkUnits(overBudget)).toBeGreaterThan(MAX_WORK_UNITS);
    expect(await countTokens(overBudget)).toBeNull();
  });

  // Guards the correction that killed an earlier design: cl100k matches a
  // whitespace run as ONE match, so a scan that only uses whitespace to
  // terminate words scores 32 KB of newlines at zero work.
  it("charges whitespace runs, which are single matches", async () => {
    expect(await tokenWorkUnits(repeat("\n", 32_768))).toBeGreaterThan(MAX_WORK_UNITS);
  });

  // Guards MATCH_OVERHEAD_BYTES directly. Sized to stay under the length
  // pre-check, so the pre-check cannot pass this test on the floor term's
  // behalf — the earlier version of this test was killed by the pre-check and
  // guarded nothing.
  it("charges per-match overhead, not bytes alone", async () => {
    const manyTinyMatches = repeat("a1", 200_000);
    const work = (await tokenWorkUnits(manyTinyMatches)) ?? 0;
    const bytes = Buffer.byteLength(manyTinyMatches, "utf8");
    expect(manyTinyMatches.length).toBeLessThan(MAX_WORK_UNITS / (MATCH_OVERHEAD_BYTES + 1));
    expect(work).toBeGreaterThan(bytes * MATCH_OVERHEAD_BYTES);
  });

  // Guards the length pre-check. Sized so the scan is what the pre-check
  // avoids: 20M chars scans in ~223 ms, and the work budget would decline the
  // input anyway, so a smaller fixture asserts nothing about the pre-check —
  // an earlier version of this test used one and the mutant survived it.
  it("refuses over-long input without scanning it", async () => {
    await countTokens("warm the encoding");
    const tooLong = "a ".repeat(10_000_000);
    expect(tooLong.length).toBeGreaterThan(MAX_WORK_UNITS / (MATCH_OVERHEAD_BYTES + 1));
    const started = Date.now();
    expect(await countTokens(tooLong)).toBeNull();
    expect(Date.now() - started).toBeLessThan(50);
  });
});

describe("countTokens constants", () => {
  // Pinned on BOTH sides. A one-sided bound is satisfied by absurd values:
  // MAX_WORK_UNITS = 1 passes `toBeLessThanOrEqual`, and MATCH_OVERHEAD_BYTES
  // = 1000 passes `toBeGreaterThanOrEqual`.
  it("keeps the work budget at its measured derivation", () => {
    // See MAX_WORK_UNITS in tokens.ts for the full derivation: the ceiling
    // divided by measured contention, minus the lazy load and both scans.
    expect(MAX_WORK_UNITS).toBe(1_200_000);
  });

  it("keeps the per-match floor term", () => {
    expect(MATCH_OVERHEAD_BYTES).toBe(4);
  });
});

describe("special-token literals are text, not failures", () => {
  // js-tiktoken defaults disallowedSpecial to "all" and throws on these. Tool
  // output containing them is routine — this repo's specs discuss tokenizers —
  // and a throw would omit the token fields AND mark the row as a tokenizer
  // failure, which is the one label reserved for actual bugs.
  it.each(["<|endoftext|>", "<|fim_prefix|>", "prefix <|endofprompt|> suffix"])(
    "counts %s without throwing",
    async (text) => {
      const count = await countTokens(text);
      expect(count).not.toBeNull();
      expect(count).toBeGreaterThan(0);
    },
  );

  it("does not change the count of ordinary text", async () => {
    const encoding = await loadEncoding();
    const ordinary = "the quick brown fox";
    expect(await countTokens(ordinary)).toBe(encoding.encode(ordinary).length);
  });
});

describe("countTokens uses the tokenizer's own partition", () => {
  it("reads the split pattern the encoder exposes rather than restating one", async () => {
    const encoding = await loadEncoding();
    // Own property at runtime, absent from js-tiktoken's published types — the
    // same reason tokens.ts reads it defensively. If an upgrade drops it,
    // countTokens declines everything, and this assertion is what says so.
    const { patStr } = encoding as unknown as { patStr?: unknown };
    expect(typeof patStr).toBe("string");
    // The branches that make a whitespace run one match, which is what an
    // independently written partition kept getting wrong.
    expect(String(patStr)).toContain("[\\r\\n]*");
    expect(String(patStr)).toContain("\\s+(?!\\S)");
  });
});
