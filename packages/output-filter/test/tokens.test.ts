import { describe, expect, it } from "vitest";
import {
  MATCH_OVERHEAD_BYTES,
  MAX_WORK_UNITS,
  countTokens,
  tokenWorkUnits,
} from "../src/tokens.js";

const repeat = (unit: string, n: number): string =>
  unit.repeat(Math.ceil(n / unit.length)).slice(0, n);

// Spec §8. Every fixture is a recipe plus a size so the tables are reproducible.
const FIXTURES: ReadonlyArray<{ id: string; text: string }> = [
  { id: "PROSE", text: repeat("The quick brown fox jumps over the lazy dog. ", 20_000) },
  {
    id: "TS",
    text: repeat("export function foo(bar: string): number { return bar.length; }\n", 20_000),
  },
  { id: "JSON_MIN", text: repeat('{"a":1,"bb":22,"ccc":333},', 20_000) },
  { id: "JA", text: repeat("日本語のテキストです。処理速度を測定しています。", 20_000) },
  { id: "NFD", text: repeat("éééé ", 20_000) },
  { id: "RULE_1500", text: repeat(`${"=".repeat(1500)}\n`, 20_000) },
  { id: "BOX_64", text: repeat(`${"═".repeat(64)}\n`, 20_000) },
  { id: "SPACES", text: repeat(" ", 32_768) },
  { id: "NEWLINES", text: repeat("\n", 32_768) },
  { id: "XLF", text: repeat("x\n", 400_000) },
  { id: "A1", text: repeat("a1", 400_000) },
];

const loadEncoding = async () => {
  const { getEncoding } = await import("js-tiktoken");
  return getEncoding("cl100k_base");
};

// Half the operator's 1500 ms per-tool-call ceiling, because record-output runs
// two counters and both are synchronous, so they add (spec §4.1).
const PER_CALL_BUDGET_MS = 750;

describe("countTokens bounds every fixture", () => {
  // The headline property. v4 does not chunk, so a non-declined count is the
  // tokenizer's own output and any difference at all is a bug — not a
  // tolerance to be widened.
  it.each(FIXTURES)("$id is exact when it is measured at all", async ({ text }) => {
    const count = await countTokens(text);
    if (count === null) return;
    const encoding = await loadEncoding();
    expect(count).toBe(encoding.encode(text).length);
  });

  // Duration is measured, never delegated to a framework timeout: a Vitest
  // timeout is a setTimeout and cannot interrupt a synchronous encode, so a
  // 70-second call reports green under a 5-second timeout.
  it.each(FIXTURES)("$id either declines or stays within budget", async ({ text }) => {
    await countTokens("warm the encoding");
    const started = Date.now();
    await countTokens(text);
    expect(Date.now() - started).toBeLessThanOrEqual(PER_CALL_BUDGET_MS);
  });
});

describe("countTokens decline decisions", () => {
  // Guards the correction that killed v3: cl100k matches a whitespace run as a
  // SINGLE match, so a scan that only uses whitespace to terminate words scores
  // 32 KB of newlines at zero work and admits a 46-second encode.
  it.each([
    { id: "SPACES", text: repeat(" ", 32_768) },
    { id: "NEWLINES", text: repeat("\n", 32_768) },
  ])("declines $id — a whitespace run is one match, not free", async ({ text }) => {
    expect(await countTokens(text)).toBeNull();
  });

  it("measures ordinary prose far above any pathological fixture's size", async () => {
    expect(await countTokens(repeat("The quick brown fox. ", 150_000))).not.toBeNull();
  });

  // Guards MATCH_OVERHEAD_BYTES. Without the floor term this shape has a max
  // match of 1 byte under any partition, so the product admits 5 MB.
  it("declines high-match-count input past the work budget", async () => {
    expect(await countTokens(repeat("a1", 2_000_000))).toBeNull();
  });

  it("declines rather than returning zero", async () => {
    const declined = await countTokens(repeat(" ", 32_768));
    expect(declined).toBeNull();
    expect(declined).not.toBe(0);
  });
});

describe("countTokens constants", () => {
  // Pinned to literals. An assertion written against the constant itself only
  // proves cap + 1 > cap, which holds at any value.
  it("keeps the work budget at the measured derivation", () => {
    // 750_000 us budget / 0.137 us per work unit = 5_474_452, / 3 for machine
    // headroom. Raising this past ~5.4M breaks the per-call budget on RULE_1500.
    expect(MAX_WORK_UNITS).toBeLessThanOrEqual(1_800_000);
  });

  it("keeps the per-match floor term", () => {
    // Measured floor 0.514 us/byte / 0.137 = 3.75, rounded up.
    expect(MATCH_OVERHEAD_BYTES).toBeGreaterThanOrEqual(4);
  });
});

describe("the work computation itself", () => {
  // Asserted directly rather than inferred from a stopwatch. Measuring match
  // length in UTF-16 code units instead of UTF-8 bytes under-counts multi-byte
  // content 3x — the error that killed v2 — and a timing assertion misses it,
  // because the mutant's admitted sizes still happen to encode under budget on
  // the fixtures that use it.
  it("measures match length in UTF-8 bytes, not code units", async () => {
    const box = repeat(`${"═".repeat(200)}\n`, 20_000);
    const work = await tokenWorkUnits(box);
    // "═" is 3 bytes / 1 code unit, so a code-unit reading lands near a third.
    expect(work).toBeGreaterThan(MAX_WORK_UNITS * 3);
    expect(await countTokens(box)).toBeNull();
  });

  // Boundary for the comparison operator. "abcd " tokenizes as "abcd" then
  // " abcd" repeatedly, so the largest match is 5 bytes and the total is 5n:
  // work = 9 * 5n, and 9 * 5 * 40_000 is exactly MAX_WORK_UNITS. `>=` declines
  // this input; `>` admits it.
  it("admits work exactly equal to the budget", async () => {
    const atBudget = "abcd ".repeat(40_000);
    expect(await tokenWorkUnits(atBudget)).toBe(MAX_WORK_UNITS);
    expect(await countTokens(atBudget)).not.toBeNull();
  });

  it("declines one work unit past the budget", async () => {
    const overBudget = `${"abcd ".repeat(40_000)}x`;
    const work = await tokenWorkUnits(overBudget);
    expect(work).toBeGreaterThan(MAX_WORK_UNITS);
    expect(await countTokens(overBudget)).toBeNull();
  });
});

describe("countTokens uses the tokenizer's own partition", () => {
  // Guards the correction that let v3 quote GPT-2's pat_str instead of
  // cl100k's, missing four alternatives including the whitespace branches.
  it("scans with the pattern the encoder itself exposes", async () => {
    const encoding = await loadEncoding();
    // Own property at runtime, absent from js-tiktoken's published types — the
    // same reason tokens.ts reads it defensively. If an upgrade drops it,
    // countTokens declines everything, and this assertion is what says so.
    const { patStr } = encoding as unknown as { patStr?: unknown };
    expect(typeof patStr).toBe("string");
    // A fixture whose decline decision differs between the two patterns: a
    // whitespace run is one match under cl100k, and unmatched under a pattern
    // lacking the \s branches.
    expect(await countTokens(repeat(" ", 32_768))).toBeNull();
  });
});
