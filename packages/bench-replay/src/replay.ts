import { normalizedCostUsd } from "@megasaver/stats";
import { buildVerdict, costRatioOf } from "./report.js";
import { prepareArms } from "./transform.js";
import type { ApplySaver, PreparedArms } from "./transform.js";
import type {
  Arm,
  ArmUsage,
  DriftSmokeResult,
  PairResult,
  RecordedRequest,
  ReplayOrder,
  ReplayVerdict,
  RequestUsage,
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

// A PURE byte-replay of one precomputed sequence. It never consults the saver:
// the transform ran once, up front, in `prepareArms`. That is what lets the two
// pairs send byte-identical bodies for the same arm, which is the only thing
// that makes comparing their two orders meaningful.
export async function replayArm(input: {
  arm: Arm;
  bodies: readonly RecordedRequest[];
  send: Send;
  now?: () => number;
}): Promise<ArmUsage> {
  const now = input.now ?? Date.now;
  const startedAtMs = now();
  const total = {
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
  };
  const perRequest: RequestUsage[] = [];

  // Sequential on purpose: the API's prompt cache is order-dependent, so
  // parallelising would measure a different (and meaningless) cache pattern.
  for (const [index, body] of input.bodies.entries()) {
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
    startedAtMs,
    finishedAtMs: now(),
    perRequest,
  };
}

// Replays both arms back-to-back in the given order. The order is an explicit
// REQUIRED argument, never a default, because it is a measurement parameter:
// the two arms share a byte-identical system+tools prefix, so whichever runs
// first pays cache_creation ($10/Mtok) for it and whichever runs second reads
// the same bytes at cache_read ($0.50/Mtok) — a ~20x discount handed to the
// second arm by the calendar, not by the saver. A single run of this function
// therefore CANNOT produce a trustworthy ratio on its own; use
// `replayBothOrders`, which is the only path to a verdict.
export async function replayPair(input: {
  arms: PreparedArms;
  send: Send;
  order: ReplayOrder;
  now?: () => number;
}): Promise<PairResult> {
  const run = (arm: Arm): Promise<ArmUsage> =>
    replayArm({
      arm,
      bodies: input.arms[arm],
      send: input.send,
      ...(input.now === undefined ? {} : { now: input.now }),
    });

  // Awaited one at a time and in the stated order: running the arms
  // concurrently would have them racing for the same cache entry, measuring
  // neither. Spelled out per branch so the order is legible, not computed.
  let baseline: ArmUsage;
  let megasaver: ArmUsage;
  if (input.order === "baseline-first") {
    baseline = await run("baseline");
    megasaver = await run("megasaver");
  } else {
    megasaver = await run("megasaver");
    baseline = await run("baseline");
  }
  return { order: input.order, baseline, megasaver, costRatio: costRatioOf(baseline, megasaver) };
}

// The only path to a verdict, because it is the only one that can see the
// order effect at all. Replays the pair twice — baseline-first, then
// megasaver-first — and refuses if the two ratios disagree beyond
// `orderTolerance`, on the same fail-closed posture as every other guard here.
//
// ASSUMPTION THE CALLER MUST HONOUR: the two pair runs are NOT separated by a
// cache cool-down. The Anthropic prompt cache has a ~5 minute TTL, so by the
// second pair every shared prefix is already warm from the first and both arms
// read it at cache_read. That is the point: it is what makes the two runs
// comparable to each other. It also means the reported ratio describes a
// warm-cache regime, and a caller who inserts a long sleep between the runs
// invalidates the comparison rather than improving it.
export async function replayBothOrders(input: {
  task: string;
  requests: readonly RecordedRequest[];
  applySaver: ApplySaver;
  send: Send;
  orderTolerance: number;
  now?: () => number;
  baselineDriftSmoke?: DriftSmokeResult;
}): Promise<ReplayVerdict> {
  const clock = input.now === undefined ? {} : { now: input.now };
  // ONCE, before anything is sent. All four arm runs below are byte-replays of
  // these two sequences, so the saver's statefulness and its randomUUID cannot
  // reach the measurement — and the hook is spawned once per tool call for the
  // whole gate rather than once per megasaver arm.
  const arms = prepareArms({ requests: input.requests, applySaver: input.applySaver });

  const baselineFirst = await replayPair({
    arms,
    send: input.send,
    order: "baseline-first",
    ...clock,
  });
  const megasaverFirst = await replayPair({
    arms,
    send: input.send,
    order: "megasaver-first",
    ...clock,
  });

  // BOTH pairs are reported, because the quoted ratio is the mean of both.
  // Handing the verdict one pair's arms next to a two-pair number is how a
  // reader ends up checking guards against data other than what they are
  // reading. Only the TOLERANCE crosses this boundary: `buildVerdict` derives
  // the order check — and its refusal — from the very pairs it reports, so the
  // number and the arms shown beside it cannot come from different data.
  return buildVerdict(input.task, [baselineFirst, megasaverFirst], arms, {
    orderTolerance: input.orderTolerance,
    ...(input.baselineDriftSmoke === undefined
      ? {}
      : { baselineDriftSmoke: input.baselineDriftSmoke }),
  });
}
