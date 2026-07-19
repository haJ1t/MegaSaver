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

export type ArmUsage = {
  arm: Arm;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  normalizedCostUsd: number;
};

export type ReplayVerdict = {
  task: string;
  baseline: ArmUsage;
  megasaver: ArmUsage;
  // baseline ÷ megasaver on normalized cost; >1 means megasaver is cheaper.
  costRatio: number;
};
