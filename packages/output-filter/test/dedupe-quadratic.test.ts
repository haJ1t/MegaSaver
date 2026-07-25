import { describe, expect, it } from "vitest";
import { HAMMING_DEDUPE_THRESHOLD, dedupe } from "../src/dedupe.js";
import { rankFeatureNameSchema } from "../src/rank-features.js";
import type { RankFeatures, RankedChunk } from "../src/rank.js";
import { hammingDistance, simhash } from "../src/simhash.js";
import { filterOutput } from "../src/types.js";

// dedupe() compared every chunk against every kept hash — O(n^2) 64-bit BigInt
// Hamming compares over a chunk count nothing caps. High-entropy output (build
// logs, CSV, hex dumps) has no duplicates, so every chunk survives and the scan
// is maximal: the MCP tool call / PostToolUse hook blocks for the whole time.
//
// Why a growth RATIO and not a wall-clock ceiling: this guard shipped with a
// 5 s ceiling at 128k lines and documented the reverted cost as 13.5 s (the
// changeset said 17.4 s — the two never agreed). Reproduced on the machine that
// wrote them, node v25.8.2, the reverted scan costs 6.8 / 6.9 / 7.7 s: a 1.4x
// margin, not the 2.7x claimed. A machine ~1.5x faster — or a cheaper BigInt
// path in a future Node — greens this guard with the quadratic scan restored,
// which is the silent-green failure the ceiling existed to prevent. A ratio has
// no machine-tuned constant in it: the all-pairs scan is quadratic in chunk
// count, so doubling the input costs it ~4x, while the banded lookup is linear
// and costs ~2x. Load and CPU speed move both samples together.
const LINES = 128_000; // 3,200 chunks at 40 lines/chunk
const HALF_LINES = LINES / 2;
// Measured through filterOutput, node v25.8.2: banded 1.95-2.09x idle and
// 2.06-2.17x under four busy cores; all-pairs 4.48x. 2.75 leaves ~27% headroom
// on the linear side at the worst load sampled, and the quadratic side clears
// it by 1.6x.
const MAX_GROWTH = 2.75;
// Minimum per SIDE, not minimum of per-trial ratios. Scheduler noise can only
// inflate a duration, so each side's minimum converges on its noise-free cost.
// Minimising the per-trial ratio instead pairs an inflated half sample with a
// clean full one and biases the result DOWN — that form read 2.55 with the
// defect restored where this one reads 4.48.
const TRIALS = 3;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic high-entropy log: one 8-char hex token per line, no repeats to
// collapse and no near-duplicates to fold, so every chunk reaches the scan.
const hexLog = (lines: number, seed: number): string => {
  const rnd = mulberry32(seed);
  const out: string[] = [];
  for (let i = 0; i < lines; i += 1) out.push(rnd().toString(16).slice(2, 10));
  return out.join("\n");
};

const zeroFeatures = (): RankFeatures =>
  Object.fromEntries(rankFeatureNameSchema.options.map((n) => [n, 0])) as RankFeatures;

const ranked = (text: string): RankedChunk => ({
  text,
  startLine: 1,
  endLine: 1,
  score: 0,
  features: zeroFeatures(),
});

const filterHexLog = async (raw: string) =>
  filterOutput({
    raw,
    mode: "balanced",
    source: { kind: "command", command: "cat", args: ["build.log"] },
  });

const sample = async (raw: string): Promise<number> => {
  const started = performance.now();
  await filterHexLog(raw);
  return performance.now() - started;
};

describe("filterOutput — quadratic dedupe scan on high-entropy output", () => {
  it(`grows under ${MAX_GROWTH}x from ${HALF_LINES / 1000}k to ${LINES / 1000}k lines`, async () => {
    const half = hexLog(HALF_LINES, 1);
    const full = hexLog(LINES, 1);

    // Guard the driver: a compressed generic_shell run is the path that reaches
    // dedupe. If either changes, the timings below stop measuring the scan.
    // Doubles as warm-up, so trial 0 does not carry the JIT cost.
    for (const raw of [half, full]) {
      const result = await filterHexLog(raw);
      expect(result.decision).toBe("compressed");
      expect(result.classification.category).toBe("generic_shell");
    }

    let bestHalf = Number.POSITIVE_INFINITY;
    let bestFull = Number.POSITIVE_INFINITY;
    for (let trial = 0; trial < TRIALS; trial += 1) {
      bestHalf = Math.min(bestHalf, await sample(half));
      bestFull = Math.min(bestFull, await sample(full));
    }

    expect(bestFull / bestHalf).toBeLessThan(MAX_GROWTH);
  }, 300_000);
});

describe("dedupe — banded candidate lookup keeps all-pairs semantics", () => {
  // The banding is a pigeonhole shortcut: 64 bits in HAMMING_DEDUPE_THRESHOLD+1
  // bands, so any pair within the threshold shares a whole band. Break that
  // relation (fewer bands, higher threshold) and dedupe silently starts keeping
  // near-duplicates the all-pairs scan folded.
  it("matches a brute-force all-pairs scan on a mixed corpus", () => {
    const rnd = mulberry32(7);
    const texts: string[] = [];
    for (let i = 0; i < 400; i += 1) {
      const base = `worker ${rnd().toString(16).slice(2, 8)} finished task ${i % 40} in pool`;
      // Every 3rd entry is a near-duplicate of its predecessor (trailing
      // punctuation only), so the corpus has real folds to disagree about.
      texts.push(i % 3 === 0 && i > 0 ? `${texts[i - 1]}.` : base);
    }
    const chunks = texts.map(ranked);

    const brute: RankedChunk[] = [];
    const hashes: bigint[] = [];
    for (const chunk of chunks) {
      const hash = simhash(chunk.text);
      if (hashes.some((h) => hammingDistance(h, hash) <= HAMMING_DEDUPE_THRESHOLD)) continue;
      brute.push(chunk);
      hashes.push(hash);
    }

    expect(brute.length).toBeLessThan(chunks.length);
    expect(dedupe(chunks).map((c) => c.text)).toEqual(brute.map((c) => c.text));
  });
});
