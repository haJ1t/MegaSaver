import type { Send } from "./replay.js";
import { namespaceCacheRun } from "./transform.js";
import type { RecordedRequest, RequestUsage } from "./types.js";

// Disjoint from cacheRunSlot's 0-3. A probe run sharing a gate slot would warm
// the namespace the gate run is about to measure cold.
export const PROBE_SLOTS = { pos: 90, negA: 91, negB: 92 } as const;

// Decisive, not tight: live isolation drives the ratio to ~0 and inert
// isolation to ~1. A value in between means the mechanism is partially
// effective and needs investigation, not a threshold adjustment.
export const NEG_READ_RATIO_CEILING = 0.1;

export type IsolationProbeRefusal = "empty_recording" | "positive_control_never_warmed";

export interface IsolationProbeInput {
  recording: readonly RecordedRequest[];
  send: Send;
  // k is fixed at 1: one request per run, so the only possible source of a
  // cache_read is ANOTHER run. A multi-request run would read its own earlier
  // entry and the read could not be attributed.
}

export interface IsolationProbeResult {
  posCell: { runA: RequestUsage; runB: RequestUsage };
  negCell: { runA: RequestUsage; runB: RequestUsage };
  positiveControlWarmed: boolean;
  negReadRatio: number;
  isolationLive: boolean;
  refusal?: IsolationProbeRefusal;
}

const ZERO: RequestUsage = {
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
};

export async function runIsolationProbe(input: IsolationProbeInput): Promise<IsolationProbeResult> {
  const first = input.recording[0];
  if (!first) {
    return {
      posCell: { runA: ZERO, runB: ZERO },
      negCell: { runA: ZERO, runB: ZERO },
      positiveControlWarmed: false,
      negReadRatio: 0,
      isolationLive: false,
      refusal: "empty_recording",
    };
  }

  const sendSlot = async (slot: number): Promise<RequestUsage> => {
    const result = await input.send(namespaceCacheRun(first, slot));
    return {
      inputTokens: result.input_tokens ?? 0,
      cacheCreationTokens: result.cache_creation_input_tokens ?? 0,
      cacheReadTokens: result.cache_read_input_tokens ?? 0,
      outputTokens: result.output_tokens ?? 0,
    };
  };

  // Order matters: POS first, so its entry exists before NEG asks whether a
  // different namespace can reach it.
  const posA = await sendSlot(PROBE_SLOTS.pos);
  const posB = await sendSlot(PROBE_SLOTS.pos);
  const negA = await sendSlot(PROBE_SLOTS.negA);
  const negB = await sendSlot(PROBE_SLOTS.negB);

  const positiveControlWarmed = posB.cacheReadTokens > 0;
  if (!positiveControlWarmed) {
    // Without an observed read, negB.cacheReadTokens === 0 is uninformative: it
    // is equally consistent with working isolation and with a cache that never
    // engaged at all.
    return {
      posCell: { runA: posA, runB: posB },
      negCell: { runA: negA, runB: negB },
      positiveControlWarmed: false,
      negReadRatio: 0,
      isolationLive: false,
      refusal: "positive_control_never_warmed",
    };
  }

  const negReadRatio = negB.cacheReadTokens / posB.cacheReadTokens;
  return {
    posCell: { runA: posA, runB: posB },
    negCell: { runA: negA, runB: negB },
    positiveControlWarmed: true,
    negReadRatio,
    isolationLive: negReadRatio < NEG_READ_RATIO_CEILING,
  };
}
