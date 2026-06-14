import type { Block, BlockKind, MessageMeta, MessageUsage, NormalizedMessage } from "./types.js";

const TOOL_INPUT_MAX = 2000;

// Typed to avoid index-signature conflicts between noUncheckedIndexedAccess and
// biome's useLiteralKeys. Each interface has only the fields we actually read.
interface RawBlock {
  type: unknown;
  text: unknown;
  thinking: unknown;
  name: unknown;
  input: unknown;
  content: unknown;
}

interface RawLine {
  type: unknown;
  message: unknown;
  timestamp: unknown;
  gitBranch: unknown;
}

interface RawMessage {
  role: unknown;
  content: unknown;
  model: unknown;
  usage: unknown;
}

interface RawUsage {
  input_tokens: unknown;
  output_tokens: unknown;
  cache_creation_input_tokens: unknown;
  cache_read_input_tokens: unknown;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function usageFrom(value: unknown): MessageUsage | null {
  if (!isObject(value)) return null;
  const u = value as RawUsage;
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheCreationInputTokens: num(u.cache_creation_input_tokens),
    cacheReadInputTokens: num(u.cache_read_input_tokens),
  };
}

function asRawLine(value: unknown): RawLine | null {
  if (!isObject(value)) return null;
  return value as RawLine;
}

function asRawMessage(value: unknown): RawMessage | null {
  if (!isObject(value)) return null;
  return value as RawMessage;
}

function asRawBlock(value: unknown): RawBlock | null {
  if (!isObject(value)) return null;
  return value as RawBlock;
}

function blocksFromContent(content: unknown): Block[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ kind: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const blocks: Block[] = [];
  for (const item of content) {
    const raw = asRawBlock(item);
    if (!raw) continue;
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
      const rawContent = raw.content;
      const text = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent ?? "");
      blocks.push({ kind: "tool_result", text: text.slice(0, TOOL_INPUT_MAX) });
    }
  }
  return blocks;
}

// Raw (already JSON-parsed) transcript line → normalized message, or null when
// the line is not a renderable turn (attachment / queue-operation / last-prompt
// / system / malformed). Only user + assistant turns are surfaced.
export function normalizeLine(raw: unknown): NormalizedMessage | null {
  const line = asRawLine(raw);
  if (!line) return null;
  const type = line.type;
  if (type !== "user" && type !== "assistant") return null;
  const message = asRawMessage(line.message);
  if (!message) return null;
  const blocks = blocksFromContent(message.content);
  if (blocks.length === 0) return null;
  const ts = typeof line.timestamp === "string" ? line.timestamp : "";
  const role: NormalizedMessage["role"] = type;
  // exactOptionalPropertyTypes forbids assigning `undefined` to optional fields,
  // so build `meta` incrementally and only spread it in when it has a signal.
  const meta: MessageMeta = {};
  if (typeof message.model === "string") meta.model = message.model;
  const usage = usageFrom(message.usage);
  if (usage) meta.usage = usage;
  if (typeof line.gitBranch === "string" && line.gitBranch.length > 0) {
    meta.gitBranch = line.gitBranch;
  }
  return {
    role,
    ts,
    blocks,
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  } satisfies NormalizedMessage;
}

export type { Block, BlockKind, MessageMeta, MessageUsage, NormalizedMessage };
