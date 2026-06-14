import type { Block, BlockKind, NormalizedMessage } from "./types.js";

const TOOL_INPUT_MAX = 2000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function blocksFromContent(content: unknown): Block[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ kind: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const blocks: Block[] = [];
  for (const raw of content) {
    if (!isObject(raw)) continue;
    const type = raw.type;
    if (type === "text" && typeof raw.text === "string") {
      blocks.push({ kind: "text", text: raw.text });
    } else if (type === "thinking" && typeof raw.thinking === "string") {
      blocks.push({ kind: "thinking", text: raw.thinking });
    } else if (type === "tool_use") {
      const name = typeof raw.name === "string" ? raw.name : "tool";
      const input = JSON.stringify(raw.input ?? {}).slice(0, TOOL_INPUT_MAX);
      blocks.push({ kind: "tool_use", text: `${name}(${input})` });
    } else if (type === "tool_result") {
      const text = typeof raw.content === "string" ? raw.content : JSON.stringify(raw.content ?? "");
      blocks.push({ kind: "tool_result", text: text.slice(0, TOOL_INPUT_MAX) });
    }
  }
  return blocks;
}

// Raw (already JSON-parsed) transcript line → normalized message, or null when
// the line is not a renderable turn (attachment / queue-operation / last-prompt
// / system / malformed). Only user + assistant turns are surfaced.
export function normalizeLine(raw: unknown): NormalizedMessage | null {
  if (!isObject(raw)) return null;
  const type = raw.type;
  if (type !== "user" && type !== "assistant") return null;
  const message = raw.message;
  if (!isObject(message)) return null;
  const blocks = blocksFromContent(message.content);
  if (blocks.length === 0) return null;
  const ts = typeof raw.timestamp === "string" ? raw.timestamp : "";
  const role: NormalizedMessage["role"] = type;
  return { role, ts, blocks } satisfies NormalizedMessage;
}

export type { Block, BlockKind, NormalizedMessage };
