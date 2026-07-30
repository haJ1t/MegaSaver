import { describe, expect, it } from "vitest";
import { HAMMING_DEDUPE_THRESHOLD } from "../src/dedupe.js";
import { hammingDistance, simhash } from "../src/simhash.js";
import { filterOutput } from "../src/types.js";

// SC3-4 end to end: two near-duplicate chunks where the LATER one carries the
// error evidence. Document-order survival delivered the earlier boring block
// and silently discarded the only chunk naming the failure — the highest-
// scored cluster member must survive instead.

const ERROR_LINE = "ledger entry 39 error: reconcile failed for the dispatch queue";
const BENIGN_LAST_LINE = "ledger entry 39 reconciles the evening dispatch queue cleanly";

function ledgerBlock(lastLine: string): string {
  const lines: string[] = [];
  for (let i = 0; i < 39; i += 1) {
    lines.push(`ledger entry ${i} reconciles the evening dispatch queue cleanly`);
  }
  lines.push(lastLine);
  return lines.join("\n");
}

const BENIGN_BLOCK = ledgerBlock(BENIGN_LAST_LINE);
const ERROR_BLOCK = ledgerBlock(ERROR_LINE);

function fillerBlock(seed: number): string {
  const vocab = [
    ["atrium", "planter", "drains", "overflow", "gravel"],
    ["gallery", "curator", "rotates", "exhibit", "labels"],
    ["stable", "farrier", "trims", "hooves", "evenly"],
  ][seed % 3] as string[];
  const lines: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    lines.push(
      `${vocab[0]} note ${seed}-${i}: the ${vocab[1]} ${vocab[2]} ${vocab[3]} ${vocab[4]}`,
    );
  }
  return lines.join("\n");
}

it("fixture guard: the two blocks sit inside the simhash fold threshold", () => {
  const distance = hammingDistance(simhash(BENIGN_BLOCK), simhash(ERROR_BLOCK));
  expect(distance).toBeLessThanOrEqual(HAMMING_DEDUPE_THRESHOLD);
});

describe("dedupe keeps the highest-scored cluster member (SC3-4)", () => {
  it("the later error-bearing near-duplicate survives the fold", async () => {
    const raw = [BENIGN_BLOCK, ERROR_BLOCK, fillerBlock(0), fillerBlock(1), fillerBlock(2)].join(
      "\n",
    );
    // Compressed band with a generous budget: the fold is dedupe's alone, and
    // whichever member survives is delivered.
    const result = await filterOutput({ raw, mode: "balanced", maxReturnedBytes: 100_000 });

    expect(result.decision).toBe("compressed");
    expect(result.excerpts).toHaveLength(4);

    const delivered = result.excerpts.map((e) => e.text).join("\n");
    expect(delivered, "the cluster's error evidence lost to an earlier boring duplicate").toContain(
      ERROR_LINE,
    );
    expect(delivered).not.toContain(BENIGN_LAST_LINE);
  });
});
