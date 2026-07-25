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

// Counted once per distinct tool call, mirroring how often production applies
// the saver. `applied > 0` only proves the hook RETURNED something; an arm that
// handed back the same bytes measured nothing, and that is invisible in the
// outcome counters alone.
export type ToolResultBytes = { original: number; transformed: number };

export type RequestUsage = {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
};

// What the saver did, for the whole gate. Computed once by `prepareArms`, never
// per arm run: the saver is consulted before a single request is sent, and all
// four arm runs then replay the SAME two frozen byte sequences.
export type TransformSummary = { saver: SaverOutcomes; bytes: ToolResultBytes };

export type ArmUsage = RequestUsage & {
  arm: Arm;
  normalizedCostUsd: number;
  // The size of the prompt-cache discount the second arm inherits depends
  // entirely on the wall-clock gap since the first arm warmed the shared prefix.
  // Left unrecorded, that gap is an unmeasured input to every ratio here.
  startedAtMs: number;
  finishedAtMs: number;
  // The megasaver arm's cache_read collapsing while baseline's stays large is
  // the one diagnostic that makes a prefix-churn regression obvious on sight;
  // summing it away hides exactly that.
  perRequest: readonly RequestUsage[];
};

export type ArmIntegrity = {
  applied: number;
  // applied ÷ (applied + passthrough). `applied > 0` alone let a saver that
  // rewrote 1 tool call in 100 report a healthy "no effect" verdict, so the
  // share the saver actually touched is part of the check, not just its count.
  appliedFraction: number;
  originalBytes: number;
  transformedBytes: number;
  // transformed ÷ original. Bounded on BOTH sides: a ceiling alone passes an
  // empty-string saver (ratio 0) as the strongest possible result.
  byteRatio: number;
  ok: boolean;
};

export type DriftSmokeResult = { ok: boolean; tolerance: number };

// How many recorded requests carry each `model`. The cost model prices them all
// at one rate card, so this is what lets a reader see the mispricing rather than
// inherit it silently — see `modelHistogram`.
export type ModelRequestCount = { model: string; requests: number };

export type ReplayOrder = "baseline-first" | "megasaver-first";

// Both arms share a byte-identical system+tools prefix, so whichever runs first
// pays cache_creation ($10/Mtok) for it and whichever runs second reads it at
// cache_read ($0.50/Mtok). Running the pair in one fixed order therefore hands
// the second arm a discount that no property of the saver earned. Measuring
// both orders is what turns that bias from invisible into reportable.
export type OrderCheck = {
  ratioBaselineFirst: number;
  ratioMegasaverFirst: number;
  // |difference| relative to the baseline-first ratio.
  spread: number;
  tolerance: number;
  // The mean of the two orders — what a caller should quote, since neither
  // single order is free of the cache-warming asymmetry.
  combinedRatio: number;
};

// Which guards actually ran, carried on the verdict itself. A reader who sees
// only a costRatio cannot tell a smoke-tested number from a calibrated one, and
// an absent check must read as "unverified" (null) rather than as "passed".
export type VerdictVerification = {
  integrity: ArmIntegrity;
  order: OrderCheck | null;
  baselineDriftSmoke: DriftSmokeResult | null;
};

export type PairResult = {
  order: ReplayOrder;
  baseline: ArmUsage;
  megasaver: ArmUsage;
  costRatio: number;
};

export type ReplayVerdict = {
  task: string;
  // EVERY pair the reported ratio was derived from, in run order. Carrying one
  // pair's arms next to a two-pair average is how a reader ends up checking
  // guards against data other than the number they are reading.
  pairs: readonly PairResult[];
  transform: TransformSummary;
  // baseline ÷ megasaver on normalized cost; >1 means megasaver is cheaper.
  costRatio: number;
  // The `max_tokens` BOTH arms were replayed under. Generation is capped because
  // the replay never uses the model's output, so `costRatio` above is an
  // INPUT-SIDE comparison (cache_creation + cache_read + input), NOT an
  // end-to-end cost comparison. Carried on the verdict so a consumer cannot read
  // the ratio without the caveat attached to it.
  generationCapTokens: number;
  verified: VerdictVerification;
};
