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
// On SIZE: 128k lines (1.1 MB) → 3,200 chunks at 40 lines/chunk. NOT smaller —
// the defect is quadratic and the fix linear, so size is what separates them.
// Measured on this repo (node v25.8.2): 64k lines cost 3.7 s, UNDER the ceiling
// and silently green; 128k lines cost 13.5 s. With the fix, 128k lines cost
// 0.5 s (the rest of the pipeline alone is 0.13 s). Do not lower SIZE.
//
// On the ceiling: 5 s matches rank-redos.test.ts — loose enough for a loaded
// runner (this suite runs under `turbo test` with ~12 packages in parallel),
// while the defect still overshoots it by 2.7x.
const CEILING_MS = 5_000;
const LINES = 128_000;

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

describe("filterOutput — quadratic dedupe scan on high-entropy output", () => {
  it(`filters ${LINES / 1000}k lines of high-entropy output under ${CEILING_MS} ms`, async () => {
    const raw = hexLog(LINES, 1);
    const started = performance.now();
    const result = await filterOutput({
      raw,
      mode: "balanced",
      source: { kind: "command", command: "cat", args: ["build.log"] },
    });
    const ms = performance.now() - started;
    // Guard the driver: a compressed generic_shell run is the path that reaches
    // dedupe. If either changes, the timing above stops measuring the scan.
    expect(result.decision).toBe("compressed");
    expect(result.classification.category).toBe("generic_shell");
    expect(ms).toBeLessThan(CEILING_MS);
  }, 120_000);
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
