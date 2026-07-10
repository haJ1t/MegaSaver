import { describe, expect, it } from "vitest";
import { fitBudget } from "../src/fit.js";
import { chunkByFormat } from "../src/parsers/index.js";
import { rankFeatureNameSchema } from "../src/rank-features.js";
import { type Chunk, scoreChunk } from "../src/rank.js";

const chunk = (text: string): Chunk => ({ text, startLine: 1, endLine: 1 });

const rankChunks = async (text: string) =>
  (await chunkByFormat(text))
    .map((c) => scoreChunk(undefined, c))
    .sort((a, b) => b.score - a.score);

const PYTEST_FIXTURE = [
  "=================================== FAILURES ===================================",
  "_______________________________ test_division _________________________________",
  "",
  "    def test_division():",
  ">       assert divide(1, 0) == 0",
  "E       ZeroDivisionError: division by zero",
  "",
  "tests/test_math.py:8: ZeroDivisionError",
  "=========================== short test summary info ============================",
  "FAILED tests/test_math.py::test_division - ZeroDivisionError: division by zero",
  "========================= 2 failed, 1 passed in 0.05s ==========================",
].join("\n");

const CARGO_FIXTURE = [
  "running 2 tests",
  "test tests::test_add ... ok",
  "test tests::test_parse ... FAILED",
  "",
  "failures:",
  "",
  "---- tests::test_parse stdout ----",
  "thread 'tests::test_parse' panicked at src/lib.rs:28:9:",
  "called `Result::unwrap()` on an `Err` value: ParseError",
  "",
  "failures:",
  "    tests::test_parse",
  "",
  "test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s",
].join("\n");

const GO_FIXTURE = [
  "=== RUN   TestAdd",
  "--- PASS: TestAdd (0.00s)",
  "=== RUN   TestDivide",
  "    math_test.go:15: Divide(1, 0) = 0; want error",
  "--- FAIL: TestDivide (0.00s)",
].join("\n");

const ESLINT_FIXTURE = [
  "/app/src/foo.ts",
  "  3:7   error    'x' is assigned a value but never used  no-unused-vars",
  "",
  "✖ 1 problem (1 error, 0 warnings)",
].join("\n");

describe("scoreChunk (spec §6 stage 5)", () => {
  it("returns a RankFeatures record keyed by every RankFeatureName", () => {
    const ranked = scoreChunk("find the bug", chunk("hello"));
    for (const name of rankFeatureNameSchema.options) {
      expect(ranked.features).toHaveProperty(name);
      expect(typeof ranked.features[name]).toBe("number");
    }
  });

  it("scores an error line above plain noise", () => {
    const err = scoreChunk(undefined, chunk("Error: something failed"));
    const noise = scoreChunk(undefined, chunk("ok ok ok ok"));
    expect(err.score).toBeGreaterThan(noise.score);
  });

  it("scores a TS diagnostic line above plain noise", () => {
    const diag = scoreChunk(undefined, chunk("src/x.ts(1,1): error TS2322: nope"));
    const noise = scoreChunk(undefined, chunk("ok ok ok ok"));
    expect(diag.score).toBeGreaterThan(noise.score);
  });

  it("scores a stacktrace line above plain noise", () => {
    const trace = scoreChunk(undefined, chunk("    at fn (/app/x.ts:10:5)"));
    const noise = scoreChunk(undefined, chunk("ok ok ok ok"));
    expect(trace.score).toBeGreaterThan(noise.score);
  });

  it("rewards intent keyword matches", () => {
    const hit = scoreChunk("database connection", chunk("database connection refused"));
    const miss = scoreChunk("database connection", chunk("unrelated text here"));
    expect(hit.features.keywordScore).toBeGreaterThan(miss.features.keywordScore);
  });

  it("rewards chunks referencing recent session files", () => {
    const hint = { recentFiles: ["src/target.ts"] as const };
    const hit = scoreChunk(undefined, chunk("touched src/target.ts"), hint);
    expect(hit.features.recentFileScore).toBeGreaterThan(0);
  });

  it("expresses penalties as positive magnitudes", () => {
    const ranked = scoreChunk(undefined, chunk("noise"));
    expect(ranked.features.duplicatePenalty).toBeGreaterThanOrEqual(0);
    expect(ranked.features.noisePenalty).toBeGreaterThanOrEqual(0);
  });
});

// Regression: the ERROR signal missed CamelCase exception names and the panic
// signal missed Rust's "panicked", so failure blocks under-scored relative to
// summary/passing noise. These assert the broadened markers fire while the
// lowercase precision (no over-match of benign "error" prose) is preserved.
describe("scoreChunk failure-marker breadth (ranker regression)", () => {
  it("credits a CamelCase exception name as an error signal", () => {
    // \bError\b never matched mid-word, so this used to score errorScore 0.
    const ranked = scoreChunk(undefined, chunk("E       ZeroDivisionError: division by zero"));
    expect(ranked.features.errorScore).toBe(4);
  });

  it("credits AssertionError / TypeError / ParseError suffixes too", () => {
    expect(scoreChunk(undefined, chunk("tests/x.py:14: AssertionError")).features.errorScore).toBe(
      4,
    );
    expect(scoreChunk(undefined, chunk("caught a TypeError here")).features.errorScore).toBe(4);
    expect(scoreChunk(undefined, chunk("on an `Err` value: ParseError")).features.errorScore).toBe(
      4,
    );
  });

  it("credits Rust 'panicked' as an error signal", () => {
    // \bpanic\b stopped before the 'ked', so a real panic line scored 0.
    const ranked = scoreChunk(undefined, chunk("thread 'main' panicked at src/lib.rs:1:1:"));
    expect(ranked.features.errorScore).toBe(4);
  });

  it("still credits the bare 'panic' word", () => {
    expect(scoreChunk(undefined, chunk("kernel panic")).features.errorScore).toBe(4);
  });

  it("keeps the existing lowercase 'error' behaviour (no over-boost of prose)", () => {
    // The bug fix must NOT change this benign sentence: the lowercase \berror\b
    // arm already matched it before, so its errorScore stays exactly 4.
    expect(scoreChunk(undefined, chunk("error handling is configurable")).features.errorScore).toBe(
      4,
    );
  });

  it("does NOT treat arbitrary CamelCase words as errors", () => {
    // The CamelCase arm targets the *Error suffix only — a generic CamelCase
    // identifier with no failure token must stay at errorScore 0.
    expect(
      scoreChunk(undefined, chunk("ConfigurableHandler renders the SidebarPanel")).features
        .errorScore,
    ).toBe(0);
  });
});

// Integration: after chunkByFormat + ranking, the failure block carries the
// broadened error signal and outranks passing-run noise. Asserts ordering, not
// just presence — this is the originally reported Phase-3a parser regression.
describe("ranking integration: failures outrank passing-run noise", () => {
  it("pytest: the ZeroDivisionError traceback block now carries an error signal", async () => {
    const ranked = await rankChunks(PYTEST_FIXTURE);
    const failure = ranked.find(
      (r) => r.text.includes("def test_division") && r.text.includes("ZeroDivisionError"),
    );
    expect(failure).toBeDefined();
    // Was errorScore 0 (only the file path scored) before the CamelCase fix.
    expect(failure?.features.errorScore).toBe(4);
    // And it now outranks the bare "=== FAILURES ===" banner chunk.
    const banner = ranked.find((r) => /^=+\s*FAILURES/.test(r.text));
    expect(failure?.score).toBeGreaterThan(banner?.score ?? 0);
  });

  it("cargo: the panicked + ParseError block outranks the passing run header", async () => {
    const ranked = await rankChunks(CARGO_FIXTURE);
    const panicBlock = ranked.find(
      (r) => r.text.includes("panicked at") && r.text.includes("ParseError"),
    );
    const runHeader = ranked.find((r) => r.text.includes("running 2 tests"));
    expect(panicBlock).toBeDefined();
    expect(runHeader).toBeDefined();
    expect(panicBlock?.features.errorScore).toBe(4);
    // Before: panic block scored 1 (file path only) and ranked below the
    // header (4, via the "FAILED" token). After: 5 > 4, the flip.
    expect((panicBlock?.score ?? 0) > (runHeader?.score ?? 0)).toBe(true);
  });

  it("go: the --- FAIL: block ranks above noise and passing tests are collapsed out", async () => {
    const ranked = await rankChunks(GO_FIXTURE);
    const failure = ranked.find((r) => r.text.includes("--- FAIL: TestDivide"));
    expect(failure).toBeDefined();
    expect(failure?.score).toBeGreaterThanOrEqual(5);
    // The passing TestAdd must not survive into any ranked chunk.
    expect(ranked.some((r) => r.text.includes("TestAdd"))).toBe(false);
  });

  it("eslint: the error file group outranks the problems summary", async () => {
    const ranked = await rankChunks(ESLINT_FIXTURE);
    const group = ranked.find((r) => r.text.includes("/app/src/foo.ts"));
    const summary = ranked.find((r) => /✖ \d+ problem/.test(r.text));
    expect(group).toBeDefined();
    expect(summary).toBeDefined();
    expect((group?.score ?? 0) > (summary?.score ?? 0)).toBe(true);
  });
});

// FIX D (semantic-ast-read gap): an EXACT intent-token match in a declaration
// must rank at/near the top and survive budget pressure. Previously a small
// intent-matched function scored low (keywordScore only) and lost to larger,
// error/diagnostic-heavy off-intent blocks.
describe("scoreChunk exact-intent-match bump", () => {
  it("ranks a tiny exact-intent-match declaration above a larger off-intent block", () => {
    // The wanted declaration: name == intent token, otherwise unremarkable.
    const target = scoreChunk(
      "parseConfig",
      chunk("export function parseConfig(raw: string) { return JSON.parse(raw); }"),
    );
    // A larger off-intent block that scores well on raw signals (file path +
    // diagnostic-looking content) but contains NO intent token.
    const offIntent = scoreChunk(
      "parseConfig",
      chunk("src/other.ts(1,1): error TS2322: nope\n".repeat(20)),
    );
    expect(target.score).toBeGreaterThan(offIntent.score);
  });

  it("gives a decisive bump only on a whole-token match, not a substring", () => {
    const exact = scoreChunk("config", chunk("function config() {}"));
    const substring = scoreChunk("config", chunk("function configuration() {}"));
    expect(exact.score).toBeGreaterThan(substring.score);
  });

  it("does not bump when intent is absent", () => {
    const withIntent = scoreChunk("parseConfig", chunk("function parseConfig() {}"));
    const noIntent = scoreChunk(undefined, chunk("function parseConfig() {}"));
    expect(withIntent.score).toBeGreaterThan(noIntent.score);
  });
});

describe("fitBudget pins the top intent match under budget pressure", () => {
  it("keeps the intent match even when a higher-scored off-intent chunk would fill the budget first", () => {
    // Isolate the pin from the score bump: force an off-intent chunk to outscore
    // the intent chunk (override score) so it sorts first and, kept greedily,
    // fills the budget — leaving no room for the intent chunk. fitBudget pins
    // the top intent-scoring chunk (keywordScore>0), so it survives regardless.
    const intentMatch = scoreChunk("parseConfig", chunk("function parseConfig() {}"));
    expect(intentMatch.features.keywordScore).toBeGreaterThan(0);

    const offIntentBase = scoreChunk(undefined, chunk("a".repeat(40)));
    expect(offIntentBase.features.keywordScore).toBe(0);
    const offIntent = { ...offIntentBase, score: intentMatch.score + 100 };

    // Budget holds both only if the intent chunk is reserved first; the higher-
    // scored off-intent chunk alone leaves under one intent chunk of room.
    const budget = Buffer.byteLength(offIntent.text, "utf8") + 1;
    const kept = fitBudget([offIntent, intentMatch], budget);

    expect(kept).toContain(intentMatch);
  });

  it("still drops the intent match if it alone overflows the budget", () => {
    // Pinning must not blow the hard byte budget — an oversized intent chunk
    // that cannot fit is not force-kept.
    const huge = scoreChunk("parseConfig", chunk("function parseConfig() {}\n".repeat(100)));
    const tiny = scoreChunk(undefined, chunk("ok"));
    const budget = Buffer.byteLength(tiny.text, "utf8") + 5;
    const kept = fitBudget([huge, tiny], budget);
    expect(kept).not.toContain(huge);
    expect(kept).toContain(tiny);
  });
});

describe("D18: Unicode-aware tokenizer", () => {
  it("Turkish intent matches across dotless-i case (fails on ASCII split)", () => {
    // Lowercase "ışık" vs uppercase "IŞIK" fold to the same token "isik". The
    // old [^a-z0-9] split fragmented them to DISJOINT ASCII pieces ({k} vs
    // {i,ik}) -> 0 hits, so this discriminates the fix; the fold gives 1.
    const chunk = { text: "IŞIK yandı", startLine: 1, endLine: 1 };
    const scored = scoreChunk("mavi ışık", chunk);
    expect(scored.features.keywordScore).toBe(1);
  });

  it("accent folding is symmetric across case (İ/ı/ç/ş)", () => {
    const chunk = { text: "KIRMIZI İŞÇİ ÇALIŞIYOR", startLine: 1, endLine: 1 };
    const scored = scoreChunk("kırmızı işçi çalışıyor", chunk);
    expect(scored.features.keywordScore).toBe(3);
  });

  it("ASCII tokenization is unchanged (identifiers, digits, underscores)", () => {
    const chunk = { text: "parseConfig v2 reads snake_case_keys", startLine: 1, endLine: 1 };
    const scored = scoreChunk("parseConfig snake_case_keys", chunk);
    // "snake_case_keys" splits on "_" exactly as before: snake, case, keys
    expect(scored.features.keywordScore).toBe(4);
  });
});
