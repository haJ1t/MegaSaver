import type { Arm, RecordedRequest } from "./types.js";

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

// Produces the body to send for one arm. Baseline is a deep copy of the
// recording; megasaver is the same conversation with each tool_result's text
// replaced by the saver's decision. Everything else — model, system, tools,
// message order, roles, non-tool_result blocks — round-trips untouched, because
// the two arms must differ ONLY by the saver's transform for the comparison to
// mean anything.
//
// Pure per-request by design: applying the saver at most once per tool call
// across the whole sequence is the REPLAY loop's job (it is the only layer that
// knows the sequence), so this function stays trivially testable.
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
