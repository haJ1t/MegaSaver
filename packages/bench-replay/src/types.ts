import { z } from "zod";

// A recorded /v1/messages request body. Deliberately permissive: the recorder
// stores bodies VERBATIM and the replayer must round-trip unknown fields
// untouched, so only the parts we rewrite are described here.
export const recordedRequestSchema = z
  .object({
    model: z.string(),
    messages: z.array(z.unknown()),
  })
  .passthrough();

export type RecordedRequest = z.infer<typeof recordedRequestSchema>;

export type Arm = "baseline" | "megasaver";

// A fail-open `null` from the saver is indistinguishable from a legitimate
// passthrough decision, so a missing binary or a crashed hook would turn the
// megasaver arm into a second baseline and report costRatio ≈ 1.00 as a clean
// "the saver has no effect" result. Counting the three outcomes separately is
// what makes that visible.
export type SaverOutcomes = { applied: number; passthrough: number; failed: number };

export type RequestUsage = {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
};

export type ArmUsage = RequestUsage & {
  arm: Arm;
  normalizedCostUsd: number;
  saver: SaverOutcomes;
  // The megasaver arm's cache_read collapsing while baseline's stays large is
  // the one diagnostic that makes a prefix-churn regression obvious on sight;
  // summing it away hides exactly that.
  perRequest: readonly RequestUsage[];
};

export type ReplayVerdict = {
  task: string;
  baseline: ArmUsage;
  megasaver: ArmUsage;
  // baseline ÷ megasaver on normalized cost; >1 means megasaver is cheaper.
  costRatio: number;
};
