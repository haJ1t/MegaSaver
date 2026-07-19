import type { Arm, RecordedRequest } from "./types.js";

// Returns the replacement text for a tool_result's content, or null to leave it
// as recorded (the saver's passthrough decision). Injected so unit tests need no
// subprocess; production wiring spawns the real `mega hooks saver` binary.
export type ApplySaver = (rawToolResult: string) => string | null;

type ToolResultBlock = { type: "tool_result"; content: unknown };

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

// A tool_result's `content` is either a plain string or — the shape the Anthropic
// API actually accepts, and real recorded Claude Code transcripts show in ~14% of
// tool_results — an array of content blocks. Handling only the string form would
// silently under-transform the megasaver arm, biasing the benchmark toward "no
// effect". Multiple text blocks are joined for the saver call and replaced by a
// single block at the first text block's position; non-text blocks (images,
// tool_reference, …) pass through untouched, in order.
function rewriteToolResultContent(block: ToolResultBlock, applySaver: ApplySaver): void {
  const { content } = block;
  if (typeof content === "string") {
    const replacement = applySaver(content);
    if (replacement !== null) block.content = replacement;
    return;
  }
  if (!Array.isArray(content)) return;
  const textBlocks = content.filter(isTextBlock);
  if (textBlocks.length === 0) return; // nothing to compress (e.g. image-only)
  const raw = textBlocks.map((b) => b.text).join("\n");
  const replacement = applySaver(raw);
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
export function transformRequest(
  body: RecordedRequest,
  arm: Arm,
  applySaver: ApplySaver,
): RecordedRequest {
  const copy = structuredClone(body) as RecordedRequest;
  if (arm === "baseline") return copy;

  for (const message of copy.messages) {
    if (typeof message !== "object" || message === null) continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (isToolResultBlock(block)) rewriteToolResultContent(block, applySaver);
    }
  }
  return copy;
}
