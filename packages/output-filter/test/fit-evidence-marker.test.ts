import { describe, expect, it } from "vitest";
import { compressDiff } from "../src/compress/diff.js";
import { compressJson } from "../src/compress/json.js";
import { compressProse } from "../src/compress/prose.js";
import { compressTsc } from "../src/compress/tsc.js";
import { compressVitest } from "../src/compress/vitest.js";
import { fitBudget } from "../src/fit.js";
import { rankFeatureNameSchema } from "../src/rank-features.js";
import type { RankFeatures, RankedChunk } from "../src/rank.js";
import { filterOutput } from "../src/types.js";

// A3b (spec 2026-07-28-saver-compression-integrity §W3): a collapse marker is
// EVIDENCE, not filler, and must survive budget pressure.
//
// `collapseRepeatedLines` folds a run into its first line plus
// `… [repeated N times]`. That marker is emitted as its own line, so it becomes
// an ordinary member of an ordinary chunk — and an ordinary chunk is something
// `fitBudget` drops when the budget runs out. Measured: it did. The model was
// handed a single heartbeat line with no indication that 800 more existed.
//
// The count is the whole point of folding. Losing it turns a lossless summary
// into a silently misleading one: the model cannot even know to expand.
//
// SHIPS RED.

// The run collapses to two lines (first occurrence + count), so benign filler
// has to follow it to fill out that chunk — otherwise the error bulk lands in
// the SAME 40-line chunk and carries the marker to safety on its score, and the
// test passes without exercising anything.
function corpusWithCollapsibleRun(): string {
  const lines: string[] = [];
  for (let i = 0; i < 600; i += 1) lines.push("[info] heartbeat ok");
  for (let i = 0; i < 60; i += 1) lines.push(`[debug] cache entry ${i} refreshed normally`);
  // Deliberately varied: near-identical error lines get folded by the simhash
  // dedupe into a single chunk, which frees enough budget for the marker's
  // chunk to survive on luck rather than on policy.
  const kinds = ["TypeError", "RangeError", "ReferenceError", "SyntaxError", "EvalError"];
  const ops = ["parse", "resolve", "serialize", "dispatch", "commit", "flush", "reduce"];
  for (let i = 0; i < 900; i += 1) {
    const kind = kinds[i % kinds.length];
    const op = ops[i % ops.length];
    lines.push(
      `ERROR ${kind} in ${op}Handler at /repo/src/mod-${i}/${op}-${i}.ts:${i}:${i % 90} — failed to ${op} record ${i * 7} of batch ${i % 13}`,
    );
  }
  return lines.join("\n");
}

describe("fitBudget — collapse markers are evidence", () => {
  it("keeps the repeated-run marker when the budget drops its chunk", async () => {
    const result = await filterOutput({
      raw: corpusWithCollapsibleRun(),
      mode: "aggressive",
      intent: "why is the handler failing",
    });

    expect(result.decision).toBe("compressed");

    const delivered = [result.summary, ...result.excerpts.map((e) => e.text)].join("\n");
    expect(
      delivered,
      "the 600-line run collapsed to one line plus a count; dropping the count " +
        "leaves the model believing it saw the whole thing",
    ).toContain("[repeated 600 times]");
  });
});

// SC3-3: the A3b reservation covered only normalize's two marker forms. Every
// compressor emits its own counted marker — the ONLY record of what it removed
// (the A1 honesty contract) — and each competed on raw score in the compressed
// band, so budget pressure erased exactly the evidence the marker existed to
// carry (B7 family). Reproduced empirically for the vitest shape below; the
// per-family cases feed fitBudget the marker line each compressor ACTUALLY
// emits, so a drifting emission format fails here instead of silently falling
// out of the reservation.

// Empirical B7 shape: a vitest run whose 600 passing rows fold into
// `  … [600 passing collapsed]` while 300 lexically varied failures overflow
// the budget. Every failure line is EXACTLY the same byte length and the
// caller budget is an exact multiple of it, so the greedy fill leaves zero
// slack — the marker cannot ride in on leftover bytes, only on policy. The
// marker line scores 0; every failure scores on testFailure + filePath.
const FAIL_LINE_BYTES = 120;
const EXACT_BUDGET_LINES = 33;

const VOCAB = [
  "ember",
  "quartz",
  "willow",
  "falcon",
  "harbor",
  "medley",
  "onyx",
  "prairie",
  "sable",
  "tundra",
  "velvet",
  "wicker",
  "zephyr",
  "cobalt",
  "dune",
  "fjord",
  "grove",
  "heath",
  "islet",
  "juniper",
] as const;

function fixedWidthFailLine(i: number): string {
  const a = VOCAB[i % VOCAB.length] as string;
  const b = VOCAB[(i * 7 + 3) % VOCAB.length] as string;
  const c = VOCAB[(i * 13 + 5) % VOCAB.length] as string;
  const d = VOCAB[(i * 17 + 11) % VOCAB.length] as string;
  const base = `FAIL test/${a}/${b}-${i}.test.ts > ${a} ${b} ${c} ${d} case ${i} expected ${i * 3} received ${i * 7}`;
  return base.padEnd(FAIL_LINE_BYTES, "#");
}

function vitestRunWithCollapsedPasses(): string {
  const lines: string[] = [];
  for (let i = 0; i < 600; i += 1) {
    lines.push(` ✓ suite ${i} > verifies scenario ${i} behaves (${i % 40}ms)`);
  }
  for (let i = 0; i < 300; i += 1) lines.push(fixedWidthFailLine(i));
  return lines.join("\n");
}

describe("fitBudget — compressor-emitted counted markers are evidence (SC3-3)", () => {
  it("keeps the vitest passing-collapsed marker under budget pressure", async () => {
    const result = await filterOutput({
      raw: vitestRunWithCollapsedPasses(),
      mode: "aggressive",
      maxReturnedBytes: FAIL_LINE_BYTES * EXACT_BUDGET_LINES,
      source: { kind: "command", command: "pnpm", args: ["test"] },
    });

    expect(result.decision).toBe("compressed");
    expect(result.compressor).toBe("vitest");
    // Fixture guard: the budget was genuinely contended — enough distinct
    // failure lines survived dedupe to fill it. Without this, a fixture whose
    // lines folded away would fit whole and pass for the wrong reason.
    const failExcerpts = result.excerpts.filter((e) => e.score > 0);
    expect(failExcerpts.length).toBeGreaterThanOrEqual(EXACT_BUDGET_LINES - 1);

    const delivered = [result.summary, ...result.excerpts.map((e) => e.text)].join("\n");
    expect(
      delivered,
      "600 passing rows folded into one counted marker; dropping it leaves the " +
        "model believing the failures were the whole run",
    ).toContain("[600 passing collapsed]");
  });
});

const zeroFeatures = (): RankFeatures =>
  Object.fromEntries(rankFeatureNameSchema.options.map((n) => [n, 0])) as RankFeatures;

const ranked = (text: string, score: number): RankedChunk => ({
  text,
  startLine: 1,
  endLine: 1,
  score,
  features: zeroFeatures(),
});

// The marker line each compressor ACTUALLY emitted on the fixture — a literal
// here would keep passing after the emission format drifted out of the
// reservation's grammar.
function emittedMarkerLine(compressed: string): string {
  const line = compressed.split("\n").find((l) => l.includes("… ["));
  if (line === undefined) throw new Error("fixture produced no counted marker");
  return line;
}

const PROSE_DOC = [
  "# Guide",
  "",
  "First paragraph stays verbatim in every section of the document.",
  "",
  "Second paragraph gets folded away by the section rule.",
  "",
  "Third paragraph gets folded away with it into the counted marker.",
  "",
  "- alpha item",
  "- beta item",
  "- gamma item",
  "- delta item",
  "- epsilon item",
].join("\n");

const JSON_DOC = JSON.stringify(
  Array.from({ length: 25 }, (_, i) => ({ id: i, name: `row ${i}`, active: i % 2 === 0 })),
);

const TSC_DOC = [
  "src/app.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.",
  "npm chatter line one about the build pipeline",
  "npm chatter line two about the build pipeline",
  "Found 1 error in src/app.ts:3",
].join("\n");

const DIFF_DOC = [
  "diff --git a/file.ts b/file.ts",
  "--- a/file.ts",
  "+++ b/file.ts",
  "@@ -1,12 +1,12 @@",
  " context line one",
  " context line two",
  " context line three",
  " context line four",
  " context line five",
  "-const before = 1;",
  "+const after = 2;",
  " trailing context",
].join("\n");

const VITEST_DOC = [
  " ✓ suite one > first case passes (2ms)",
  " ✓ suite two > second case passes (1ms)",
  " ✓ suite three > third case passes (3ms)",
  "FAIL test/app.test.ts > renders the widget",
].join("\n");

describe.each([
  ["prose", () => compressProse(PROSE_DOC)],
  ["structured", () => compressJson(JSON_DOC, undefined)],
  ["typescript", () => compressTsc(TSC_DOC)],
  ["diff", () => compressDiff(DIFF_DOC)],
  ["vitest", () => compressVitest(VITEST_DOC)],
] as const)("fitBudget reserves the %s compressor's marker", (_family, compress) => {
  it("keeps the marker chunk ahead of higher-scored filler", () => {
    const marker = emittedMarkerLine(compress());
    // 300 + 100 fill the 405 budget to a 5-byte slack — smaller than any
    // marker, so the marker survives on reservation or not at all.
    const kept = fitBudget(
      [ranked(marker, 0), ranked("x".repeat(300), 10), ranked("y".repeat(100), 9)],
      405,
    );
    expect(kept.map((c) => c.text)).toContain(marker);
  });
});
