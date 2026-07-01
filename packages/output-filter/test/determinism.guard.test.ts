import { describe, expect, it } from "vitest";
import { filterOutput } from "../src/types.js";

// These guard the REAL filterOutput pipeline (types.ts): the simhash dedupe()
// collapse behind the skipDedupe evidence exemption, and the score-ordering
// sort at types.ts:278. A prior version of this file targeted applyEngineRanking
// (a pure per-chunk .map with no fold and no sort), so both its assertions were
// tautological — order could not vary and distinct codes could never fold.

// A 40-line block (chunkByLines default) built from DISTINCT filler lines so
// collapseRepeatedLines/collapseSimilar leave every line intact, ending in one
// diagnostic line. Two such blocks become two chunks that simhash sees as near
// duplicates — close enough that dedupe() must genuinely adjudicate them, not
// so identical that a single token vanishes into the majority vote.
function scanBlock(tag: string, diagnostic: string): string {
  const lines: string[] = [];
  for (let i = 0; i < 39; i += 1) {
    lines.push(`scan pass ${tag} step ${i} inspecting the source token stream`);
  }
  lines.push(diagnostic);
  return lines.join("\n");
}

describe("filterOutput dedupe evidence + ordering guard", () => {
  it("preserves both distinct diagnostics through the real dedupe pass", async () => {
    // generic_shell classification -> NOT in DIAGNOSTIC_CATEGORIES and no
    // diagnostic parser fires, so skipDedupe is false and dedupe() actually
    // runs. The two chunks are near-duplicates (same shape) but carry distinct
    // file+column+rule+code evidence; dedupe must keep BOTH.
    const raw = [
      scanBlock(
        "alpha",
        "check flagged handler.ts at column 5 with rule no-implicit-any code TS2322",
      ),
      scanBlock(
        "beta",
        "check flagged reducer.ts at column 8 with rule no-unsafe-index code TS7053",
      ),
    ].join("\n");

    const result = await filterOutput({
      raw,
      intent: "list the two flagged problems",
      mode: "aggressive",
      source: { kind: "command", command: "bash", args: ["lint.sh"] },
    });

    expect(result.classification.category).toBe("generic_shell");
    const text = result.excerpts.map((e) => e.text).join("\n");
    // Both error codes AND both file paths survive: dedupe did not fold one
    // near-duplicate chunk's distinct evidence into the other.
    expect(text).toContain("TS2322");
    expect(text).toContain("TS7053");
    expect(text).toContain("handler.ts");
    expect(text).toContain("reducer.ts");
  });

  it("produces identical excerpt order and text across runs (real sort)", async () => {
    // Multiple chunks with differing relevance exercise the b.score - a.score
    // sort at types.ts:278. Two runs on the same input must be byte-identical.
    const raw = [
      scanBlock(
        "alpha",
        "check flagged handler.ts at column 5 with rule no-implicit-any code TS2322",
      ),
      scanBlock(
        "beta",
        "check flagged reducer.ts at column 8 with rule no-unsafe-index code TS7053",
      ),
      scanBlock("gamma", "unrelated informational note about cache warm-up on the worker pool"),
    ].join("\n");

    const input = {
      raw,
      intent: "TS2322 handler.ts",
      mode: "aggressive" as const,
      source: { kind: "command" as const, command: "bash", args: ["lint.sh"] },
    };

    const first = await filterOutput(input);
    const second = await filterOutput(input);

    expect(first.excerpts.map((e) => e.text)).toEqual(second.excerpts.map((e) => e.text));
    expect(first.excerpts.map((e) => e.score)).toEqual(second.excerpts.map((e) => e.score));
  });
});
