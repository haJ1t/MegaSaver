import { describe, expect, it } from "vitest";
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
