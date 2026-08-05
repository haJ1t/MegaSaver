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
  {
    id: "JA",
    text: repeat("日本語のテキストです。処理速度を測定しています。", 20_000),
    measured: true,
  },
  { id: "NFD", text: repeat("éééé ", 20_000), measured: true },
  { id: "B64_WRAPPED", text: repeat(`${repeat("aGVsbG8gd29ybGQ", 76)}\n`, 20_000), measured: true },
  { id: "HETERO_ONE_B64_LINE", text: `${CLEAN_LOG_50K}${"A".repeat(800)}\n`, measured: true },
  { id: "HETERO_LONG_B64_LINE", text: `${CLEAN_LOG_50K}${"B".repeat(2000)}\n`, measured: true },
  { id: "RULE_1500", text: repeat(`${"=".repeat(1500)}\n`, 20_000), measured: false },
  { id: "BOX_64", text: repeat(`${"═".repeat(64)}\n`, 20_000), measured: false },
  { id: "SPACES", text: repeat(" ", 32_768), measured: false },
  { id: "NEWLINES", text: repeat("\n", 32_768), measured: false },
  // Both are high-match-count and genuinely cheap: 400 KB is 2,000,000 work
  // units and encodes in ~80 ms. An estimator without a per-match floor term
  // admits them at 5 MB where they are not cheap; one built on a global
  // maximum wrongly refuses them here.
  { id: "XLF", text: repeat("x\n", 400_000), measured: true },
  { id: "A1", text: repeat("a1", 400_000), measured: true },
];

const loadEncoding = async () => {
  const { getEncoding } = await import("js-tiktoken");
  return getEncoding("cl100k_base");
};

// Half the operator's 1500 ms per-tool-call ceiling, because record-output runs
// two counters and both are synchronous, so they add.
const PER_CALL_BUDGET_MS = 750;

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
      expect(work).not.toBeNull();
      expect((work ?? 0) <= MAX_WORK_UNITS).toBe(measured);
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
  it("encodes the worst admitted fixture nowhere near the unguarded cost", async () => {
    const worst = repeat("日本語のテキストです。処理速度を測定しています。", 20_000);
    await countTokens("warm the encoding");

    const started = Date.now();
    expect(await countTokens(worst)).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(PER_CALL_BUDGET_MS * 5);
  });

  it("keeps the budget's own derivation honest", () => {
    // 750 ms per call (half the 1500 ms per-tool-call ceiling, two synchronous
    // counters) divided by the worst measured 0.0462 us/unit is 16,227,553.
    expect(MAX_WORK_UNITS * 0.0462).toBeLessThanOrEqual(PER_CALL_BUDGET_MS * 1000);
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
  // "a"x2234 contributes (4+2234)*2234 = 4,999,692; the pad adds one 4-byte
  // match (32) and 23 two-byte matches (276), landing exactly on the budget.
  it("admits work exactly equal to the budget", async () => {
    const atBudget = `${"a".repeat(2234)} abc${" a".repeat(23)}`;
    expect(await tokenWorkUnits(atBudget)).toBe(MAX_WORK_UNITS);
    expect(await countTokens(atBudget)).not.toBeNull();
  });

  it("declines one match past the budget", async () => {
    const overBudget = `${"a".repeat(2234)} abc${" a".repeat(24)}`;
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
    // 750_000 us / 0.0462 us per unit (worst of fifteen shapes) = 16_227_553,
    // divided by 3 for machine headroom.
    expect(MAX_WORK_UNITS).toBe(5_000_000);
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
