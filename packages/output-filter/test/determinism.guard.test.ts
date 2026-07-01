import { describe, expect, it } from "vitest";
import { filterOutput } from "../src/types.js";

// These guard the REAL filterOutput pipeline (types.ts): the simhash dedupe()
// collapse behind the skipDedupe evidence exemption, and the score-ordering
// sort at types.ts:278. A prior version of this file targeted applyEngineRanking
// (a pure per-chunk .map with no fold and no sort), so both its assertions were
// tautological — order could not vary and distinct codes could never fold.
//
// The evidence test below also had to escape a subtler tautology: its two chunks
// classified generic_shell (no exemption) but sat at simhash Hamming distance 8,
// far above HAMMING_DEDUPE_THRESHOLD=3, so dedupe() kept both regardless of the
// skipDedupe flag — flipping the exemption changed nothing. The rebuilt input
// (1) classifies as typescript via a bare `error TSxxxx:` signature that
// classify.ts::TS_OUT matches but the ts-diagnostic parser's `(line,col):`
// SIGNATURE does NOT, so usedDiagnostic stays false and the ONLY thing setting
// skipDedupe is DIAGNOSTIC_CATEGORIES.has("typescript"); and (2) chunks into two
// genuine near-duplicates at Hamming 0 that dedupe() WOULD fold if it ran.

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
  it("preserves both distinct diagnostics through the typescript dedupe exemption", async () => {
    // Both blocks share the SAME tag ("alpha") so their 39 filler lines are
    // byte-identical; the two diagnostic lines differ ONLY in the file token
    // (handler.ts vs reducer.ts) and error code (TS2322 vs TS7053). simhash is
    // bit-majority-dominated by the identical filler, so the two chunks land at
    // Hamming 0 — comfortably inside HAMMING_DEDUPE_THRESHOLD=3. If dedupe() ran
    // it would fold the second chunk and erase its distinct TS7053/reducer.ts
    // evidence. It must NOT run: the bare `error TSxxxx:` signature classifies
    // typescript (a DIAGNOSTIC_CATEGORY) without tripping the ts-diagnostic
    // parser, so skipDedupe is driven purely by the category exemption.
    const raw = [
      scanBlock("alpha", "check flagged handler.ts error TS2322: assignment not allowed here"),
      scanBlock("alpha", "check flagged reducer.ts error TS7053: assignment not allowed here"),
    ].join("\n");

    const result = await filterOutput({
      raw,
      intent: "list the two flagged problems",
      mode: "aggressive",
      source: { kind: "command", command: "bash", args: ["lint.sh"] },
    });

    // The category exemption is the thing under test: typescript is in
    // DIAGNOSTIC_CATEGORIES, so dedupe() is skipped and both chunks survive.
    expect(result.classification.category).toBe("typescript");
    const text = result.excerpts.map((e) => e.text).join("\n");
    // Both error codes AND both file paths survive: the exemption prevented
    // dedupe from folding the near-duplicate second chunk into the first. Drop
    // "typescript" from DIAGNOSTIC_CATEGORIES (or force skipDedupe false) and
    // dedupe folds the Hamming-0 pair, losing TS7053 + reducer.ts here.
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
