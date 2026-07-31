import { describe, expect, it } from "vitest";
import { ARM_RUNS, SAFETY_FACTOR, estimateGateRunBudget } from "../src/budget.js";
import type { RecordedRequest } from "../src/types.js";

function bodies(count: number): RecordedRequest[] {
  return Array.from({ length: count }, (_, i) => ({
    model: "claude-opus-5",
    max_tokens: 1,
    system: [{ type: "text", text: "S".repeat(4_000), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: "u".repeat(1_000 * (i + 1)) }],
  })) as unknown as RecordedRequest[];
}

describe("budget", () => {
  // Deliberately NOT re-deriving the estimate with simulateCacheCost +
  // normalizedCostUsd: that asserts the implementation against itself and passes
  // for any wrong-but-consistent formula. These check properties a wrong
  // implementation would break.
  it("prices all four arm runs, not one", () => {
    const estimate = estimateGateRunBudget({ recording: bodies(6), bytesPerToken: 2.6 });

    expect(ARM_RUNS).toBe(4);
    expect(estimate.perArmRunUsd).toBeGreaterThan(0);
    expect(estimate.estimatedUsd).toBeCloseTo(estimate.perArmRunUsd * ARM_RUNS, 10);
    expect(estimate.breakdown.requests).toBe(6 * ARM_RUNS);
  });

  it("grows with the recording — it is not a constant wearing a dollar sign", () => {
    const small = estimateGateRunBudget({ recording: bodies(6), bytesPerToken: 2.6 });
    const large = estimateGateRunBudget({ recording: bodies(18), bytesPerToken: 2.6 });

    expect(large.estimatedUsd).toBeGreaterThan(small.estimatedUsd);
  });

  it("refuses to start when the safety-adjusted estimate exceeds the budget", () => {
    const recording = bodies(6);
    const bare = estimateGateRunBudget({ recording, bytesPerToken: 2.6 });
    const tooSmall = bare.estimatedUsd * SAFETY_FACTOR * 0.99;

    const estimate = estimateGateRunBudget({ recording, bytesPerToken: 2.6, budgetUsd: tooSmall });

    expect(SAFETY_FACTOR).toBe(1.3);
    expect(estimate.wouldRefuse).toBe(true);
  });

  it("allows a run whose budget clears the safety factor", () => {
    const recording = bodies(6);
    const bare = estimateGateRunBudget({ recording, bytesPerToken: 2.6 });
    const enough = bare.estimatedUsd * SAFETY_FACTOR * 1.01;

    expect(
      estimateGateRunBudget({ recording, bytesPerToken: 2.6, budgetUsd: enough }).wouldRefuse,
    ).toBe(false);
  });

  it("still reports an estimate when no budget was supplied, and does not refuse", () => {
    const estimate = estimateGateRunBudget({ recording: bodies(3), bytesPerToken: 2.6 });

    expect(estimate.budgetUsd).toBeUndefined();
    expect(estimate.estimatedUsd).toBeGreaterThan(0);
    expect(estimate.wouldRefuse).toBe(false);
  });

  // Every breakdown field is a TOTAL for the whole gate run. The replay caps
  // generation at GENERATION_CAP_TOKENS (1), so a recording's own max_tokens
  // must not reach the estimate.
  it("prices output at the generation cap across all four runs, not the recorded max_tokens", () => {
    const estimate = estimateGateRunBudget({ recording: bodies(5), bytesPerToken: 2.6 });
    expect(estimate.breakdown.cappedOutputTokens).toBe(5 * ARM_RUNS);
  });
});
