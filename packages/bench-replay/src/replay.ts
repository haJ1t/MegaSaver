import { normalizedCostUsd } from "@megasaver/stats";
import { transformRequest } from "./transform.js";
import type { ApplySaver } from "./transform.js";
import type {
  Arm,
  ArmUsage,
  RecordedRequest,
  RequestUsage,
  SaverOutcomes,
  ToolResultBytes,
} from "./types.js";

// The API response fields we consume. Injected `send` keeps unit tests offline;
// production passes a real fetch against /v1/messages.
export type SendResult = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
};
export type Send = (body: RecordedRequest) => Promise<SendResult>;

// In production the PostToolUse hook fires ONCE per tool call and the compressed
// text then sits in the transcript byte-for-byte forever, so every later request
// carries the same bytes and the prompt cache stays warm. A recorded Messages
// API conversation resends its whole history each turn, so calling the saver per
// request would invoke it once per (request × tool_result) — and the real saver
// is stateful (first-sight ledger) and non-deterministic (a randomUUID chunk-set
// id lands in the returned text). The megasaver arm's prefix would mutate every
// turn and pay cache_creation ($10/Mtok) where baseline pays cache_read
// ($0.50/Mtok): a ~20x penalty manufactured by the harness, condemning the very
// feature built to prevent prefix churn. Memoizing per tool_use_id restores
// production semantics exactly.
function memoize(
  applySaver: ApplySaver,
  outcomes: SaverOutcomes,
  bytes: ToolResultBytes,
): ApplySaver {
  const decisions = new Map<string, string | null>();
  return (raw, ctx) => {
    const memoized = decisions.get(ctx.toolUseId);
    if (memoized !== undefined) return memoized; // a memoized null is reused AS null
    let decision: string | null;
    try {
      decision = applySaver(raw, ctx);
    } catch (cause) {
      outcomes.failed++;
      throw cause;
    }
    if (decision === null) outcomes.passthrough++;
    else outcomes.applied++;
    // Accumulated here rather than at the request loop because this is the one
    // place that sees each tool call exactly once — the same cardinality
    // production's PostToolUse hook fires at. Summing per request would count a
    // resent history N times and inflate both sides.
    bytes.original += Buffer.byteLength(raw, "utf8");
    bytes.transformed += Buffer.byteLength(decision ?? raw, "utf8");
    decisions.set(ctx.toolUseId, decision);
    return decision;
  };
}

export async function replayArm(input: {
  arm: Arm;
  requests: readonly RecordedRequest[];
  applySaver: ApplySaver;
  send: Send;
}): Promise<ArmUsage> {
  const total = {
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
  };
  const perRequest: RequestUsage[] = [];
  const saver: SaverOutcomes = { applied: 0, passthrough: 0, failed: 0 };
  const bytes: ToolResultBytes = { original: 0, transformed: 0 };
  const applySaver = memoize(input.applySaver, saver, bytes);

  // Sequential on purpose: the API's prompt cache is order-dependent, so
  // parallelising would measure a different (and meaningless) cache pattern.
  for (const [index, request] of input.requests.entries()) {
    let body: RecordedRequest;
    try {
      body = transformRequest(request, input.arm, applySaver);
    } catch (cause) {
      // A saver that could not be consulted is NOT a passthrough. Continuing
      // would report an inert megasaver arm as a measurement, so abort with the
      // counts that explain it — no retry.
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `replayArm(${input.arm}): saver failed on request ${index} (applied=${saver.applied} passthrough=${saver.passthrough} failed=${saver.failed}): ${reason}`,
        { cause },
      );
    }
    let usage: SendResult;
    try {
      usage = await input.send(body);
    } catch (cause) {
      // A partial replay must never be reported as a result — a half-sent arm
      // would look artificially cheap and skew the ratio. Abort loudly with
      // enough context (arm, request index, original cause) to find the
      // failure, no retry.
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`replayArm(${input.arm}): send failed on request ${index}: ${reason}`, {
        cause,
      });
    }
    const row: RequestUsage = {
      inputTokens: usage.input_tokens ?? 0,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
    };
    perRequest.push(row);
    total.inputTokens += row.inputTokens;
    total.cacheCreationTokens += row.cacheCreationTokens;
    total.cacheReadTokens += row.cacheReadTokens;
    total.outputTokens += row.outputTokens;
  }
  return {
    arm: input.arm,
    ...total,
    normalizedCostUsd: normalizedCostUsd({
      input_tokens: total.inputTokens,
      cache_creation_input_tokens: total.cacheCreationTokens,
      cache_read_input_tokens: total.cacheReadTokens,
      output_tokens: total.outputTokens,
    }),
    saver,
    bytes,
    perRequest,
  };
}
