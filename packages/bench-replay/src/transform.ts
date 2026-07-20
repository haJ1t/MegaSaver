import type {
  Arm,
  RecordedRequest,
  SaverOutcomes,
  ToolResultBytes,
  TransformSummary,
} from "./types.js";

// The tool call a tool_result belongs to, recovered from the recording. The
// saver's decision depends on all three: compression floors are per-tool
// (apps/cli/src/hooks/saver.ts minBytesFor — Bash caps at 24000, Read/LS/Grep/
// Glob/WebFetch use the plain mode budget, newer/MCP surfaces get a 16384
// floor), sourceKind is per-tool, and the chunk-set label comes from tool_input
// (a file path's extension must survive for semantic chunking to fire).
export type ToolCallContext = { toolUseId: string; toolName: string; toolInput: unknown };

// Returns the replacement text for a tool_result's content, or null to leave it
// as recorded (the saver's passthrough decision). A THROW means the saver could
// not be consulted at all — never a passthrough. Injected so unit tests need no
// subprocess; production wiring spawns the real `mega hooks saver` binary.
export type ApplySaver = (rawToolResult: string, ctx: ToolCallContext) => string | null;

type ToolResultBlock = { type: "tool_result"; tool_use_id?: unknown; content: unknown };

function isToolResultBlock(block: unknown): block is ToolResultBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "tool_result"
  );
}

function isTextBlock(block: unknown): block is { type: "text"; text: string } {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "text" &&
    typeof (block as { text?: unknown }).text === "string"
  );
}

// Every tool_result's tool_use_id matches a tool_use block in a preceding
// assistant message of the SAME body (the Messages API resends the whole
// history each turn), so the mapping resolves per-request with no cross-request
// state.
function collectToolCalls(body: RecordedRequest): Map<string, ToolCallContext> {
  const calls = new Map<string, ToolCallContext>();
  for (const message of body.messages) {
    if (typeof message !== "object" || message === null) continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
      if (b.type !== "tool_use" || typeof b.id !== "string" || typeof b.name !== "string") continue;
      calls.set(b.id, { toolUseId: b.id, toolName: b.name, toolInput: b.input });
    }
  }
  return calls;
}

// A tool_result's `content` is either a plain string or — the shape the Anthropic
// API actually accepts, and real recorded Claude Code transcripts show in ~14% of
// tool_results — an array of content blocks. Handling only the string form would
// silently under-transform the megasaver arm, biasing the benchmark toward "no
// effect". Multiple text blocks are joined for the saver call and replaced by a
// single block at the first text block's position; non-text blocks (images,
// tool_reference, …) pass through untouched, in order.
function rewriteToolResultContent(
  block: ToolResultBlock,
  ctx: ToolCallContext,
  applySaver: ApplySaver,
): void {
  const { content } = block;
  if (typeof content === "string") {
    const replacement = applySaver(content, ctx);
    if (replacement !== null) block.content = replacement;
    return;
  }
  if (!Array.isArray(content)) return;
  const textBlocks = content.filter(isTextBlock);
  if (textBlocks.length === 0) return; // nothing to compress (e.g. image-only)
  const raw = textBlocks.map((b) => b.text).join("\n");
  const replacement = applySaver(raw, ctx);
  if (replacement === null) return;
  const firstTextIdx = content.findIndex(isTextBlock);
  block.content = content.flatMap((b, i) =>
    i === firstTextIdx ? [{ type: "text", text: replacement }] : isTextBlock(b) ? [] : [b],
  );
}

// The literal prefix of the recovery footer the saver appends to every output it
// compresses — see buildRecoveryFooter in packages/context-gate/src/recovery-footer.ts.
// Only the fixed head is matched; everything after it is interpolated byte counts.
const SAVER_FOOTER_MARKER = "[Mega Saver: compressed ";

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isTextBlock)
    .map((b) => b.text)
    .join("\n");
}

// A recording is only a baseline if it was captured with MegaSaver's hooks OFF.
// Captured with the saver live, its tool_results are ALREADY compressed: the
// "baseline" arm is then secretly a megasaver run and the megasaver arm is a
// double-compression, so the ratio collapses toward 1.00 and reads as a clean
// "the saver has no effect". Nothing else in the pipeline can tell the
// difference, so the saver's own footer is the precondition we check.
export function assertUncompressedRecording(requests: readonly RecordedRequest[]): void {
  for (const [index, body] of requests.entries()) {
    for (const message of body.messages) {
      if (typeof message !== "object" || message === null) continue;
      const content = (message as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!isToolResultBlock(block)) continue;
        if (!toolResultText(block.content).includes(SAVER_FOOTER_MARKER)) continue;
        throw new Error(
          `assertUncompressedRecording: request ${index}, tool_result ${JSON.stringify(block.tool_use_id)} is already compressed — it carries the saver's "${SAVER_FOOTER_MARKER}" footer, so this conversation was recorded with MegaSaver's hooks ON. Both arms would replay pre-compressed output and the comparison would be meaningless. Re-record it with the saver disabled (mega session saver default disable).`,
        );
      }
    }
  }
}

// Produces the body to send for one arm. Baseline is a deep copy of the
// recording; megasaver is the same conversation with each tool_result's text
// replaced by the saver's decision. Everything else — model, system, tools,
// message order, roles, non-tool_result blocks — round-trips untouched, because
// the two arms must differ ONLY by the saver's transform for the comparison to
// mean anything.
//
// Pure per-request by design: applying the saver at most once per tool call
// across the whole sequence is `prepareArms`' job, so this function stays
// trivially testable.
export function transformRequest(
  body: RecordedRequest,
  arm: Arm,
  applySaver: ApplySaver,
): RecordedRequest {
  const copy = structuredClone(body) as RecordedRequest;
  if (arm === "baseline") return copy;

  const calls = collectToolCalls(copy);
  for (const message of copy.messages) {
    if (typeof message !== "object" || message === null) continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isToolResultBlock(block)) continue;
      const id = block.tool_use_id;
      const ctx = typeof id === "string" ? calls.get(id) : undefined;
      if (ctx === undefined) {
        // Defaulting to Bash here is how the harness quietly measured the wrong
        // floors and the wrong label. An unresolvable id is a real anomaly in
        // the recording, so it aborts the run instead of guessing.
        throw new Error(
          `transformRequest: tool_result ${JSON.stringify(id)} has no matching tool_use block in the recorded request`,
        );
      }
      rewriteToolResultContent(block, ctx, applySaver);
    }
  }
  return copy;
}

// In production the PostToolUse hook fires ONCE per tool call and the compressed
// text then sits in the transcript byte-for-byte forever, so every later request
// carries the same bytes and the prompt cache stays warm. A recorded Messages
// API conversation resends its whole history each turn, so consulting the saver
// per request would invoke it once per (request × tool_result) — and the real
// saver is stateful (first-sight ledger) and non-deterministic (a randomUUID
// chunk-set id lands in the returned text). Memoizing per tool_use_id restores
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

// The replay never USES generated text: assistant turns come from the recording
// and are replayed verbatim, and the saver's whole effect is on the INPUT side
// (cache_creation / cache_read / input). Resampled output is therefore pure cost
// and pure noise — at a realistic warm-cache mix it is ~26% of arm cost at
// $25/Mtok, and 200 simulated runs against a true 5% input-side saving measured
// sd 3.78% on the combined ratio, reporting the saver as a net LOSS in 15.5% of
// them. Capping generation deletes that channel.
//
// 1 rather than 0: `max_tokens: 0` is rejected outright when `stream: true`,
// which every recorded body carries, and flipping `stream` would change the
// response shape the usage assembler reads — a second difference from the
// recording, in exchange for one token.
//
// SAFE FOR THE MEASUREMENT because `max_tokens` takes no part in the prompt
// cache key: that key is the rendered prefix — `tools` -> `system` -> `messages`
// — and sampling parameters are not rendered into it. The bytes both arms share
// are untouched, which is the only reason this cap does not change the thing
// being measured.
export const GENERATION_CAP_TOKENS = 1;

// Applied to BOTH arms through this one function, so the symmetry is structural
// rather than a convention two call sites happen to honour. Any asymmetry here
// would reintroduce exactly the bias class this harness exists to eliminate.
//
// Extended thinking reserves `budget_tokens` out of `max_tokens` and the API
// rejects `budget_tokens >= max_tokens`, so a recording captured with it on
// cannot be replayed under the cap at all. Caught here, before a request is
// sent, rather than as a 400 four arm runs deep.
function capGeneration(body: RecordedRequest, index: number): RecordedRequest {
  // A named view of the only two fields this touches. The schema is a
  // passthrough, so both reach us through an index signature; declaring them
  // keeps the access dotted, which is what the lint and the type-checker each
  // insist on for the other's form.
  const capped = body as RecordedRequest & { thinking?: unknown; max_tokens?: unknown };
  const { thinking } = capped;
  if (typeof thinking === "object" && thinking !== null) {
    const budget = (thinking as { budget_tokens?: unknown }).budget_tokens;
    if (typeof budget === "number") {
      throw new Error(
        `prepareArms: request ${index} was recorded with thinking.budget_tokens=${budget}, which cannot fit under the ${GENERATION_CAP_TOKENS}-token generation cap (the API requires budget_tokens < max_tokens). Re-record with adaptive thinking; the cap cannot be applied to this conversation.`,
      );
    }
  }
  capped.max_tokens = GENERATION_CAP_TOKENS;
  return capped;
}

export type PreparedArms = TransformSummary & {
  baseline: readonly RecordedRequest[];
  megasaver: readonly RecordedRequest[];
};

// Separates TRANSFORMING from SENDING, and is the reason the gate can be
// trusted. The saver runs here — exactly once per distinct tool_use_id, before
// a single request goes out — and the two frozen sequences it produces are
// what every arm run replays, byte for byte.
//
// Memoizing inside a single arm run is NOT enough: `replayBothOrders` runs four
// arm runs, so a per-run memo hands the two megasaver arms two different byte
// sequences while baseline (a pure structuredClone) is identical in both pairs.
// Megasaver then pays cache_creation ($10/Mtok) in both pairs where baseline
// reads its own bytes back at cache_read ($0.50/Mtok) — a ~20x penalty invented
// by the harness, and one the order check structurally cannot see, because it
// lands on megasaver in BOTH orders and moves the two ratios together.
//
// It also takes the saver out of the measurement loop entirely: the hook is
// superlinear (40 KB → 5.2s, 100 KB → 27.3s) and used to run twice per tool call.
export function prepareArms(input: {
  requests: readonly RecordedRequest[];
  applySaver: ApplySaver;
}): PreparedArms {
  // Checked here rather than in the replay loop because this is the single
  // choke point every replay routes through — and the only layer that still
  // sees the RAW recording. Downstream, the megasaver bodies legitimately carry
  // the saver's footer, so the check could not tell contamination from work.
  assertUncompressedRecording(input.requests);

  const saver: SaverOutcomes = { applied: 0, passthrough: 0, failed: 0 };
  const bytes: ToolResultBytes = { original: 0, transformed: 0 };
  const applySaver = memoize(input.applySaver, saver, bytes);

  const baseline: RecordedRequest[] = [];
  const megasaver: RecordedRequest[] = [];
  for (const [index, request] of input.requests.entries()) {
    baseline.push(capGeneration(transformRequest(request, "baseline", applySaver), index));
    try {
      megasaver.push(capGeneration(transformRequest(request, "megasaver", applySaver), index));
    } catch (cause) {
      // A saver that could not be consulted is NOT a passthrough. Continuing
      // would report an inert megasaver arm as a measurement, so abort with the
      // counts that explain it — no retry, and before a cent is spent.
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `prepareArms: saver failed on request ${index} (applied=${saver.applied} passthrough=${saver.passthrough} failed=${saver.failed}): ${reason}`,
        { cause },
      );
    }
  }
  return { baseline, megasaver, saver, bytes };
}
