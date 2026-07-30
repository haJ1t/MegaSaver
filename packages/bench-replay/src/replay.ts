import { normalizedCostUsd } from "@megasaver/stats";
import { assertResolvableTransform, buildVerdict, costRatioOf } from "./report.js";
import { cacheRunSlot, namespaceCacheRun, prepareArms } from "./transform.js";
import type { ApplySaver, PreparedArms } from "./transform.js";
import type {
  Arm,
  ArmUsage,
  DriftSmokeResult,
  PairResult,
  RecordedRequest,
  RecordedRequestMeta,
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
export type Send = (body: RecordedRequest, meta?: RecordedRequestMeta) => Promise<SendResult>;

// A byte-replay of one precomputed sequence. It never consults the saver: the
// transform ran once, up front, in `prepareArms`. That is what lets both pairs
// send the same bodies for the same arm, which is what makes comparing their two
// orders meaningful.
//
// The ONE thing it adds per send is this run's cache namespace (`cacheSlot`), so
// that the four arm runs cannot share prompt-cache entries. It touches only the
// head of the system prompt and never a tool_result, so the saver's work still
// reaches the wire exactly as prepared — strip the marker and the bodies for a
// given arm are identical across pairs (see stripCacheNamespace).
export async function replayArm(input: {
  arm: Arm;
  // Which of the four arm runs this is. Distinct per run so each warms only its
  // own cache; constant across the run so it warms it at all.
  cacheSlot: number;
  bodies: readonly RecordedRequest[];
  // Index-aligned with `bodies`: one recorded request line + header set each,
  // because Claude Code's anthropic-beta set differs between the main turn and
  // its sidecar turns, so no single header set replays the whole sequence.
  metas?: readonly RecordedRequestMeta[] | undefined;
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
  for (const [index, prepared] of input.bodies.entries()) {
    const body = namespaceCacheRun(prepared, input.cacheSlot);
    let usage: SendResult;
    try {
      usage = await input.send(body, input.metas?.[index]);
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

// Replays both arms back-to-back in the given order. The order stays an explicit
// REQUIRED argument, never a default, for two reasons. It selects the two cache
// namespaces this pair runs in — which is what stops the second arm reading at
// cache_read ($0.50/Mtok) what the first paid cache_creation ($10/Mtok) to
// create, a ~20x discount that would otherwise be handed to whichever arm the
// calendar put second. And it stays a stated measurement parameter so a reader
// can see which of the four runs produced a given number.
//
// `replayBothOrders` remains the only path to a verdict: one pair is a single
// replicate, and a lone replicate cannot show whether the number reproduces.
export async function replayPair(input: {
  arms: PreparedArms;
  metas?: readonly RecordedRequestMeta[] | undefined;
  send: Send;
  order: ReplayOrder;
  now?: () => number;
}): Promise<PairResult> {
  const run = (arm: Arm): Promise<ArmUsage> =>
    replayArm({
      arm,
      cacheSlot: cacheRunSlot(input.order, arm),
      bodies: input.arms[arm],
      metas: input.metas,
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

// The only path to a verdict, because it is the only one that replays the pair
// more than once. Runs it twice — baseline-first, then megasaver-first — and
// refuses if the two ratios disagree beyond `orderTolerance`, on the same
// fail-closed posture as every other guard here.
//
// WHAT THE SECOND PAIR IS FOR — this changed on 2026-07-30. It used to control
// for arm order: the four runs shared one cache namespace, so position in the
// sequence bought a ~20x discount, and running both orders was an attempt to
// average that away. It did not work. The dominant term was not arm position
// inside a pair but PAIR position — pair 2 read back what pair 1 created — and
// no ordering of the arms cancels that. Measured: 1.598 vs 1.197 against a
// <=0.05 effect.
//
// Each arm run now has its own cache namespace (namespaceCacheRun), so all four
// start cold and warm only themselves. Order no longer carries a discount, which
// makes the two pairs independent REPLICATES of one measurement. The guard is
// unchanged in code and stronger in meaning: two ratios that disagree now
// indicate the measurement does not reproduce, rather than that the calendar
// favoured one arm.
//
// The caller must still NOT insert a cool-down between the pairs. Not for
// cross-pair warmth — that is gone — but because the two replicates should
// differ in as little as possible, and elapsed time is a variable like any
// other.
export async function replayBothOrders(input: {
  task: string;
  requests: readonly RecordedRequest[];
  metas?: readonly RecordedRequestMeta[] | undefined;
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
  // The same refusal `buildVerdict` ends on, hoisted to where it costs nothing:
  // it reads only the summary above, and nothing between here and there touches
  // that summary — `replayArm` never consults the saver.
  assertResolvableTransform(input.task, arms);

  const baselineFirst = await replayPair({
    arms,
    metas: input.metas,
    send: input.send,
    order: "baseline-first",
    ...clock,
  });
  const megasaverFirst = await replayPair({
    arms,
    metas: input.metas,
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
