import { normalizedCostUsd } from "@megasaver/stats";
import { simulateCacheCost } from "./cache-model.js";
import { GENERATION_CAP_TOKENS } from "./transform.js";
import type { RecordedRequest } from "./types.js";

// replayBothOrders sends two arms in each of two orders.
export const ARM_RUNS = 4;

// Covers the model's known cache-creation error being wrong in the cheap
// direction, plus retry overhead. Run 3 died at request 16 of arm 2 on credit
// exhaustion after 34 billed requests; a half-corpus cannot produce a verdict,
// so an over-estimate that refuses is cheaper than an under-estimate that pays.
export const SAFETY_FACTOR = 1.3;

export interface BudgetInput {
  recording: readonly RecordedRequest[];
  bytesPerToken: number;
  budgetUsd?: number;
}

export interface BudgetEstimate {
  estimatedUsd: number;
  perArmRunUsd: number;
  safetyFactor: number;
  budgetUsd: number | undefined;
  wouldRefuse: boolean;
  breakdown: { inputTokens: number; cappedOutputTokens: number; requests: number };
}

export function estimateGateRunBudget(input: BudgetInput): BudgetEstimate {
  const cost = simulateCacheCost(input.recording, { bytesPerToken: input.bytesPerToken });
  const cappedOutputTokens = input.recording.length * GENERATION_CAP_TOKENS;

  const perArmRunUsd = normalizedCostUsd({
    input_tokens: cost.inputTokens,
    cache_creation_input_tokens: cost.cacheCreationTokens,
    cache_read_input_tokens: cost.cacheReadTokens,
    output_tokens: cappedOutputTokens,
  });

  const estimatedUsd = perArmRunUsd * ARM_RUNS;
  const wouldRefuse =
    input.budgetUsd !== undefined && estimatedUsd * SAFETY_FACTOR > input.budgetUsd;

  return {
    estimatedUsd,
    perArmRunUsd,
    safetyFactor: SAFETY_FACTOR,
    budgetUsd: input.budgetUsd,
    wouldRefuse,
    // Every field here is a TOTAL for the whole gate run — one meaning, so a
    // reader never has to ask whether a number is per-run or pooled.
    breakdown: {
      inputTokens: cost.inputTokens * ARM_RUNS,
      cappedOutputTokens: cappedOutputTokens * ARM_RUNS,
      requests: input.recording.length * ARM_RUNS,
    },
  };
}
