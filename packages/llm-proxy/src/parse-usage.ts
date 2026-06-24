// Token-usage extraction for Anthropic Messages requests/responses. All inputs
// are untrusted strings from the wire, so every parse is defensive — a failure
// returns a safe zero/null, never throws (measurement must never break the
// passthrough). Nothing here reads or retains message/prompt content.

export type UsageCounts = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

// Narrow shapes (fields typed `unknown` since they come off the wire) so access
// is by declared property, not an index signature — keeps both tsc
// (noPropertyAccessFromIndexSignature) and biome (useLiteralKeys) happy.
interface RawUsage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
}
interface RawRequest {
  model?: unknown;
  messages?: unknown;
}
interface RawResponse {
  usage?: unknown;
}
interface RawStreamEvent {
  type?: unknown;
  message?: unknown;
  usage?: unknown;
}

function asObject<T>(value: unknown): T | null {
  return typeof value === "object" && value !== null ? (value as T) : null;
}

function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function usageFromRaw(usage: RawUsage): UsageCounts {
  return {
    inputTokens: int(usage.input_tokens),
    outputTokens: int(usage.output_tokens),
    cacheReadTokens: int(usage.cache_read_input_tokens),
    cacheCreationTokens: int(usage.cache_creation_input_tokens),
  };
}

export function countRequestMessages(bodyText: string): { model: string; messageCount: number } {
  const obj = asObject<RawRequest>(parseJson(bodyText));
  if (obj === null) return { model: "", messageCount: 0 };
  const model = typeof obj.model === "string" ? obj.model : "";
  const messageCount = Array.isArray(obj.messages) ? obj.messages.length : 0;
  return { model, messageCount };
}

export function parseUsageFromJson(bodyText: string): UsageCounts | null {
  const obj = asObject<RawResponse>(parseJson(bodyText));
  const usage = obj && asObject<RawUsage>(obj.usage);
  return usage ? usageFromRaw(usage) : null;
}

// Streaming responses split usage across events: `message_start` carries input +
// cache tokens (and an initial output_tokens), `message_delta` carries the final
// output_tokens. Accumulate across the SSE `data:` lines.
export function parseUsageFromSse(sseText: string): UsageCounts | null {
  let seen = false;
  const acc: UsageCounts = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  for (const line of sseText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice("data:".length).trim();
    if (payload.length === 0 || payload === "[DONE]") continue;
    const event = asObject<RawStreamEvent>(parseJson(payload));
    if (event === null) continue;
    if (event.type === "message_start") {
      const message = asObject<{ usage?: unknown }>(event.message);
      const usage = message && asObject<RawUsage>(message.usage);
      if (usage) {
        const u = usageFromRaw(usage);
        acc.inputTokens = u.inputTokens;
        acc.cacheReadTokens = u.cacheReadTokens;
        acc.cacheCreationTokens = u.cacheCreationTokens;
        acc.outputTokens = u.outputTokens;
        seen = true;
      }
    } else if (event.type === "message_delta") {
      const usage = asObject<RawUsage>(event.usage);
      if (usage) {
        acc.outputTokens = int(usage.output_tokens);
        seen = true;
      }
    }
  }
  return seen ? acc : null;
}
