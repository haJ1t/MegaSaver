import { describe, expect, it } from "vitest";
import { HAMMING_DEDUPE_THRESHOLD } from "../src/dedupe.js";
import { hammingDistance, simhash } from "../src/simhash.js";
import { filterOutput } from "../src/types.js";

// SC3-2 (spec B10): dedupe ran in EVERY band, contradicting the band contract
// right above it in types.ts — "passthrough/light keep all chunks … so no real
// signal is dropped" — and its folds appeared in no band's dropped count. A
// near-duplicate is still real signal in the bands that promise losslessness,
// and where folding IS allowed (compressed) the fold must be counted, not
// vanish between `ranked` and `deduped`.

// A 40-line block (the generic chunker's unit) of distinct, non-diagnostic,
// non-volatile lines: nothing for the collapse passes to fold, no detector
// signature, no rank signal — the block stands or falls on band policy alone.
function rosterBlock(mutate: (lines: string[]) => void = () => {}): string {
  const lines: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    lines.push(`roster shift ${i} covers the morning bakery window as planned`);
  }
  mutate(lines);
  return lines.join("\n");
}

const BLOCK_A = rosterBlock();
// One added token in one line: lexically near-identical (the fixture guard
// below pins it inside the simhash fold threshold) but carrying a token the
// first block does not have — delivering only BLOCK_A loses "quill".
const BLOCK_B = rosterBlock((lines) => {
  lines[20] = "roster shift 20 covers the morning bakery window as planned quill";
});

// Distinct-vocabulary filler blocks to move the same near-duplicate pair into
// the larger bands without touching the pair itself.
function fillerBlock(seed: number): string {
  const vocab = [
    ["harbor", "crane", "unloads", "container", "manifest"],
    ["orchard", "crew", "prunes", "apple", "rootstock"],
    ["studio", "mixer", "balances", "vocal", "reverb"],
    ["quarry", "hauler", "moves", "granite", "pallets"],
  ][seed % 4] as string[];
  const lines: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    lines.push(`${vocab[0]} log ${seed}-${i}: the ${vocab[1]} ${vocab[2]} ${vocab[3]} ${vocab[4]}`);
  }
  return lines.join("\n");
}

it("fixture guard: the two blocks sit inside the simhash fold threshold", () => {
  const distance = hammingDistance(simhash(BLOCK_A), simhash(BLOCK_B));
  expect(distance).toBeLessThanOrEqual(HAMMING_DEDUPE_THRESHOLD);
});

describe("dedupe is gated to the compressed band (SC3-2 / spec B10)", () => {
  it("passthrough delivers BOTH near-duplicate chunks", async () => {
    const raw = [BLOCK_A, BLOCK_B].join("\n");
    const result = await filterOutput({ raw, mode: "balanced" });

    expect(result.decision).toBe("passthrough");
    expect(result.excerpts).toHaveLength(2);
    expect(result.excerpts.map((e) => e.text).join("\n")).toContain("quill");
  });

  it("light delivers BOTH near-duplicate chunks", async () => {
    const raw = [BLOCK_A, BLOCK_B, fillerBlock(0)].join("\n");
    const result = await filterOutput({ raw, mode: "balanced" });

    expect(result.decision).toBe("light");
    expect(result.excerpts).toHaveLength(3);
    expect(result.excerpts.map((e) => e.text).join("\n")).toContain("quill");
  });

  it("compressed still folds the near-duplicate AND counts it as dropped", async () => {
    const raw = [BLOCK_A, BLOCK_B, fillerBlock(0), fillerBlock(1), fillerBlock(2)].join("\n");
    // Generous budget: fitBudget drops nothing, so any dropped count in the
    // summary can only come from the dedupe fold.
    const result = await filterOutput({ raw, mode: "balanced", maxReturnedBytes: 100_000 });

    expect(result.decision).toBe("compressed");
    expect(result.excerpts).toHaveLength(4);
    expect(result.summary).toContain("4 kept, 1 dropped");
  });
});
