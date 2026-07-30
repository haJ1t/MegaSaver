import type {
  Arm,
  RecordedRequest,
  ReplayOrder,
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

// The same footer, anchored where the saver actually puts it: LAST in the
// rewritten output (record-output.ts appends it as `finalText = text0 + footer`).
//
// Position is the whole discriminator. Matching the opening literal anywhere
// made a `Read` of any file that MENTIONS the footer look like a compressed
// recording — which is not hypothetical: it is why this harness could not
// record against its own repository, tripping on a regex literal in
// save-integrity.property.test.ts. Anchoring is a tightening, not a loosening:
// it now demands the footer's real structure and its real position, where the
// substring match demanded neither.
//
// `[^\]]*` cannot backtrack catastrophically — its class excludes the closing
// delimiter it is searching for, the fix shape from concepts/unbounded-run-redos.
const SAVER_FOOTER_AT_END = /\[Mega Saver: compressed \d+→\d+ B [^\]]*\]\.?\s*$/;

export type SaverCallViolation = {
  toolUseId: string;
  toolName: string;
  originalBytes: number;
  transformedBytes: number;
  reason: "missing-recovery-footer" | "not-smaller-than-original";
};

// What the REAL saver guarantees about every output it applies. Checked per
// call, because a saver breaks per call: every aggregate this harness had could
// be satisfied by any destructive transform simply by shrinking its blast radius
// — half the calls emptied measured fraction 0.500 / byteRatio 0.500 and
// reported a 2.0x "win". One bad call has to be detectable regardless of how
// many good ones surround it, and only a per-call check has that property.
//
// Both halves are enforced by the saver itself, so a violation means the arm
// does not contain the saver's work:
//   - apps/cli/src/hooks/saver.ts passes includeFooter:true + storeRawOutput:true
//     and returns updatedToolOutput ONLY for a "compressed" decision, so
//     record-output.ts appends buildRecoveryFooter to every applied output. An
//     applied output without it is content loss, not compression — the elided
//     bytes are not recoverable because nothing told the agent how to fetch them.
//   - record-output.ts's net-negative guard degrades to passthrough whenever the
//     replacement (footer included) is >= the raw, so it never returns one that
//     is not strictly smaller.
function contractViolation(
  decision: string,
  originalBytes: number,
  transformedBytes: number,
): SaverCallViolation["reason"] | null {
  if (!decision.includes(SAVER_FOOTER_MARKER)) return "missing-recovery-footer";
  if (transformedBytes >= originalBytes) return "not-smaller-than-original";
  return null;
}

// Long recordings can violate on every call (an empty-string saver violates 100
// times), and an unreadable error is a broken guard. The full count is always
// stated; only the enumeration is capped.
const MAX_LISTED_VIOLATIONS = 10;

function describeViolations(violations: readonly SaverCallViolation[]): string {
  const listed = violations
    .slice(0, MAX_LISTED_VIOLATIONS)
    .map(
      (v) =>
        `${JSON.stringify(v.toolUseId)} (${v.toolName}, ${v.originalBytes}→${v.transformedBytes} B): ${v.reason}`,
    )
    .join("; ");
  const rest = violations.length - MAX_LISTED_VIOLATIONS;
  return rest > 0 ? `${listed}; and ${rest} more` : listed;
}

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
        if (!SAVER_FOOTER_AT_END.test(toolResultText(block.content))) continue;
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
  violations: SaverCallViolation[],
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
    const originalBytes = Buffer.byteLength(raw, "utf8");
    const transformedBytes = Buffer.byteLength(decision ?? raw, "utf8");
    bytes.original += originalBytes;
    bytes.transformed += transformedBytes;
    // The same place, for the same reason: it is the only layer that holds a raw
    // beside the single replacement that will be replayed for it.
    if (decision !== null) {
      const reason = contractViolation(decision, originalBytes, transformedBytes);
      if (reason !== null) {
        violations.push({
          toolUseId: ctx.toolUseId,
          toolName: ctx.toolName,
          originalBytes,
          transformedBytes,
          reason,
        });
      }
    }
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
// `cache_control.scope: "global"` shares a cache entry beyond the session. The
// API accepts it only when EVERY preceding block is globally scoped too, and
// tool definitions render before `system` — so a recording whose `system[2]`
// carries it while 11 tools do not is rejected outright. Claude Code sends
// exactly that shape and the live session is fine, because it authenticates
// with a subscription OAuth token (`oauth-2025-04-20` is in its beta set); the
// replay must use `x-api-key`, where the entitlement does not hold. A paid run
// died on request 1 with that error.
//
// Dropping the field is the smaller change. `scope` selects how WIDELY an entry
// is shared, not what is cached: the breakpoint stays exactly where the
// recording put it, so the same bytes are cached at the same boundary. The
// alternative — adding global scope to every preceding block — would move
// entries into a shared namespace, which is the opposite of what a per-arm-run
// namespace is for. Applied to both arms through `capGeneration`'s call sites,
// so no arm can receive it and not the other.
function stripGlobalCacheScope(body: RecordedRequest): void {
  const system = (body as unknown as { system?: unknown }).system;
  if (!Array.isArray(system)) return;
  for (const block of system) {
    if (typeof block !== "object" || block === null) continue;
    const cc = (block as { cache_control?: unknown }).cache_control;
    if (typeof cc !== "object" || cc === null) continue;
    if ((cc as { scope?: unknown }).scope === "global") {
      delete (cc as { scope?: unknown }).scope;
    }
  }
}

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
  stripGlobalCacheScope(capped);
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
  const violations: SaverCallViolation[] = [];
  const applySaver = memoize(input.applySaver, saver, bytes, violations);

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
  // AFTER the loop, so one run reports every offending call rather than only the
  // first, and BEFORE anything is sent, so a broken saver costs nothing. Refusing
  // here rather than at `buildVerdict` is deliberate: this is the last layer that
  // still holds each raw beside its replacement, and the four arm runs that would
  // otherwise have to happen first are the expensive part.
  if (violations.length > 0) {
    throw new Error(
      `prepareArms: the saver reported applying a compression that does not look like one, on ${violations.length} of ${saver.applied} applied tool call(s): ${describeViolations(violations)}. Every output the real saver applies carries the "${SAVER_FOOTER_MARKER}" recovery footer and is strictly smaller than the raw it replaced (its own net-negative guard degrades to passthrough otherwise), so these calls measured content loss or a different transform — not compression. No verdict can be derived from them.`,
    );
  }
  return { baseline, megasaver, saver, bytes };
}

// ------------------------------------------------------- cache-run namespacing
//
// Prompt caching is a PREFIX MATCH. `prepareArms` builds both arm sequences ONCE
// and all four arm runs (two arms x two pair orders) replay those same bytes, so
// every run shares a byte-identical `tools` + `system` head. Measured 2026-07-30:
// baseline-first gave 1.598 and megasaver-first gave 1.197 — a 0.40 spread
// against a <=0.05 effect.
//
// The dominant term is NOT which arm ran first inside a pair; it is which PAIR
// ran first. `replayBothOrders` runs the two pairs back-to-back with no cool-down,
// so pair 2 reads at cache_read what pair 1 paid cache_creation for. An
// arm-scoped namespace is constant across both pairs and therefore leaves that
// gap untouched — which is why this is scoped per arm RUN.
//
// Four distinct namespaces means all four runs start cold and warm only
// themselves. That is also the faithful trajectory: production runs ONE arm, in
// one session, starting cold, and its later requests warm off its earlier ones.
//
// Three properties are load-bearing:
//   CONSTANT within a run  — or the run never warms itself and every request
//                            pays cache_creation.
//   DISTINCT across runs   — or the runs share entries and the bias returns.
//   EQUAL LENGTH + near-identical tokenization across runs — or one run silently
//                            carries more input tokens than another and the ratio
//                            inherits the difference. The markers below differ in
//                            exactly one ASCII digit for that reason; equal byte
//                            length alone would not guarantee equal token count.
const CACHE_NAMESPACE_PREFIX = "bench-replay cache namespace ";

const RUN_SLOT: Record<ReplayOrder, Record<Arm, number>> = {
  "baseline-first": { baseline: 0, megasaver: 1 },
  "megasaver-first": { baseline: 2, megasaver: 3 },
};

export function cacheRunSlot(order: ReplayOrder, arm: Arm): number {
  return RUN_SLOT[order][arm];
}

export function cacheNamespaceMarker(slot: number): string {
  return `${CACHE_NAMESPACE_PREFIX}${slot}\n`;
}

// Returns a body with the run's marker at the very front of the cacheable prefix.
// Non-mutating: the prepared sequences are shared by all four runs, so mutating
// one would leak a namespace into the others.
//
// Prepended INSIDE the first system block rather than added as a new one:
// `cache_control` is per-block, and the recordings put their breakpoints on
// `system[2]`/`system[3]` (verified across every recorded request, 2026-07-30),
// so a marker in `system[0]` changes the key of every breakpoint without moving
// any of them.
// A body seen through the one field this pair of functions touches. Named so the
// spread below produces a declared `system` property rather than an index
// signature, which is what lets it be read and written as `.system`.
type SystemHolder = { system?: unknown };

export function namespaceCacheRun(body: RecordedRequest, slot: number): RecordedRequest {
  const marker = cacheNamespaceMarker(slot);
  const source = body as RecordedRequest & SystemHolder;
  const copy: RecordedRequest & SystemHolder = { ...source };

  if (typeof source.system === "string") {
    copy.system = marker + source.system;
    return copy;
  }
  if (Array.isArray(source.system)) {
    const blocks = [...source.system];
    const first = blocks[0] as { text?: unknown } | undefined;
    if (first !== undefined && typeof first.text === "string") {
      blocks[0] = { ...first, text: marker + first.text };
    } else {
      // No text block to extend. A fresh leading block still namespaces the
      // prefix, and because `cache_control` travels on the block object the
      // existing breakpoints keep their meaning at their shifted indices.
      blocks.unshift({ type: "text", text: marker });
    }
    copy.system = blocks;
    return copy;
  }
  // A recording with no system prompt is namespaced by GAINING one. Refusing
  // here would buy nothing: the goal is disjoint cache namespaces, and a
  // synthesized marker achieves exactly that, equal-length in every run.
  copy.system = marker;
  return copy;
}

// Inverse of `namespaceCacheRun`, for assertions that need to compare what two
// runs sent WITHOUT the namespace difference they are supposed to have. Keeps the
// "byte-identical bodies per arm across pairs" protection real instead of
// deleting it.
export function stripCacheNamespace(body: RecordedRequest): RecordedRequest {
  const { system, ...rest } = body as RecordedRequest & SystemHolder;
  const unmark = (text: string): string =>
    text.startsWith(CACHE_NAMESPACE_PREFIX) ? text.slice(text.indexOf("\n") + 1) : text;

  if (typeof system === "string") {
    const bare = unmark(system);
    // An empty remainder means the marker WAS the whole system prompt, i.e. the
    // recording had none — so the round trip has to drop the field, not leave an
    // empty one behind.
    return (bare === "" ? rest : { ...rest, system: bare }) as RecordedRequest;
  }
  if (Array.isArray(system)) {
    const blocks = [...system];
    const first = blocks[0] as { text?: unknown } | undefined;
    if (first !== undefined && typeof first.text === "string") {
      const bare = unmark(first.text);
      if (bare === "") blocks.shift();
      else blocks[0] = { ...first, text: bare };
    }
    return { ...rest, system: blocks } as RecordedRequest;
  }
  return { ...rest, ...(system === undefined ? {} : { system }) } as RecordedRequest;
}
