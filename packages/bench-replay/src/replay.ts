import { normalizedCostUsd } from "@megasaver/stats";
import { transformRequest } from "./transform.js";
import type { ApplySaver } from "./transform.js";
import type { Arm, ArmUsage, RecordedRequest } from "./types.js";

// The API response fields we consume. Injected `send` keeps unit tests offline;
// production passes a real fetch against /v1/messages.
export type SendResult = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
};
export type Send = (body: RecordedRequest) => Promise<SendResult>;

export async function replayArm(input: {
  arm: Arm;
  requests: readonly RecordedRequest[];
  applySaver: ApplySaver;
  send: Send;
}): Promise<ArmUsage> {
  const total = {
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
  };
  // Sequential on purpose: the API's prompt cache is order-dependent, so
  // parallelising would measure a different (and meaningless) cache pattern.
  for (const [index, request] of input.requests.entries()) {
    const body = transformRequest(request, input.arm, input.applySaver);
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
    total.input_tokens += usage.input_tokens ?? 0;
    total.cache_creation_input_tokens += usage.cache_creation_input_tokens ?? 0;
    total.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
    total.output_tokens += usage.output_tokens ?? 0;
  }
  return {
    arm: input.arm,
    inputTokens: total.input_tokens,
    cacheCreationTokens: total.cache_creation_input_tokens,
    cacheReadTokens: total.cache_read_input_tokens,
    outputTokens: total.output_tokens,
    normalizedCostUsd: normalizedCostUsd(total),
  };
}
