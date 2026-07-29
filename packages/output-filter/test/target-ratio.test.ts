import { describe, expect, it } from "vitest";
import { filterOutput } from "../src/types.js";

// A4 (spec 2026-07-28-saver-compression-integrity §W1): the eligibility floor
// and the output budget were the same number, `modeToBudget(mode)`, and
// `fitBudget` packs greedily UP TO that budget — it maximises fill, it does not
// minimise output. So the saving was `1 - budget/rawBytes`: a function of how
// far the input happened to exceed a fixed constant, not of how much of the
// input was redundant.
//
// Measured consequence: at 12.5 KB in balanced mode the pipeline compressed
// 12 500 bytes down to 11 942 — a 4.5% saving for a full rank-and-fit pass. The
// input was "eligible" only because it cleared the same 12 KB the output was
// then allowed to fill.
//
// The budget must be a TARGET expressed relative to the input, capped by the
// mode ceiling — so an input just past the floor is actually reduced.
//
// SHIPS RED.

// Every line distinct, so nothing is folded by the collapse passes or the
// simhash dedupe. An earlier version of this fixture repeated one 5-line unit;
// it compressed beautifully by redundancy alone and the tests passed while the
// budget behaviour under test was untouched.
function code(bytes: number): string {
  const lines: string[] = [];
  for (let i = 0; lines.join("\n").length < bytes; i += 1) {
    lines.push(
      `export function handler${i}(input: Request${i}): Response${i} {`,
      `  const parsed${i} = schema${i}.safeParse(input.body.field${i});`,
      `  if (!parsed${i}.success) return badRequest("route-${i}", parsed${i}.error);`,
      `  return ok({ id: ${i}, value: parsed${i}.data, source: "module-${i}" });`,
      "}",
    );
  }
  return Buffer.from(lines.join("\n"), "utf8").subarray(0, bytes).toString("utf8");
}

describe("budget is a target ratio, not a fixed ceiling", () => {
  it("reduces an input that only just clears the floor", async () => {
    const raw = code(12_500);
    const result = await filterOutput({ raw, mode: "balanced" });

    expect(result.decision).toBe("compressed");
    expect(
      result.savingRatio,
      "an input just past the floor used to yield ~4.5%: the budget it was " +
        "allowed to fill was the same number that made it eligible",
    ).toBeGreaterThan(0.5);
  });

  it("still honours the mode ceiling on a large input", async () => {
    const raw = code(250_000);
    const result = await filterOutput({ raw, mode: "balanced" });

    expect(result.decision).toBe("compressed");
    // 25% of 250 KB is 62.5 KB — far past what balanced may ever return. The
    // ceiling, not the ratio, has to bind here.
    expect(result.returnedBytes).toBeLessThanOrEqual(12_000);
  });

  it("scales with the mode: aggressive returns less than safe", async () => {
    const raw = code(40_000);
    const [aggressive, safe] = await Promise.all([
      filterOutput({ raw, mode: "aggressive" }),
      filterOutput({ raw, mode: "safe" }),
    ]);
    expect(aggressive.returnedBytes).toBeLessThan(safe.returnedBytes);
  });
});
