import type { SendResult } from "./replay.js";

type WireUsage = {
  input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  output_tokens?: unknown;
};

type WireEvent = {
  type?: unknown;
  message?: { usage?: WireUsage };
  usage?: WireUsage;
  error?: { type?: unknown; message?: unknown };
};

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toSendResult(usage: WireUsage, outputTokens: number): SendResult {
  return {
    input_tokens: num(usage.input_tokens),
    cache_creation_input_tokens: num(usage.cache_creation_input_tokens),
    cache_read_input_tokens: num(usage.cache_read_input_tokens),
    output_tokens: outputTokens,
  };
}

// Recorded bodies carry `"stream": true` and MUST go out as recorded, so usage
// has to be reassembled from the event stream rather than read off a JSON body.
// The split matters: `message_start` carries the input/cache counts alongside an
// output_tokens PLACEHOLDER, and only the final `message_delta` carries the
// authoritative cumulative output count. Reading output from `message_start`
// undercounts the priciest token class ($25/Mtok — 5x plain input, 50x cache
// read) by an amount that scales with response length, so every arm would look
// cheaper than it was and the error would not be uniform across arms.
export function assembleSseUsage(sseText: string): SendResult {
  let startUsage: WireUsage | undefined;
  let deltaOutputTokens: number | undefined;

  for (const line of sseText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice("data:".length).trim();
    if (payload === "") continue;

    let event: WireEvent;
    try {
      event = JSON.parse(payload);
    } catch (cause) {
      throw new Error(`assembleSseUsage: unparseable SSE data line: ${payload.slice(0, 120)}`, {
        cause,
      });
    }

    // A stream that errors mid-flight has already emitted a message_start, so
    // ignoring this would return that partial usage as if the turn completed —
    // a silently truncated, artificially cheap request.
    if (event.type === "error") {
      throw new Error(
        `assembleSseUsage: the API streamed an error event (${String(event.error?.type ?? "unknown")}): ${String(event.error?.message ?? "")}`,
      );
    }
    if (event.type === "message_start") startUsage = event.message?.usage;
    // Each usage-bearing message_delta supersedes the last; the final one is the
    // cumulative total.
    if (event.type === "message_delta" && event.usage?.output_tokens !== undefined) {
      deltaOutputTokens = num(event.usage.output_tokens);
    }
  }

  if (startUsage === undefined) {
    throw new Error(
      "assembleSseUsage: no message_start event in the stream — input and cache counts are unknown, and a zero-usage request would silently understate the arm's cost",
    );
  }
  if (deltaOutputTokens === undefined) {
    throw new Error(
      "assembleSseUsage: no message_delta carried output_tokens — message_start's output_tokens is a placeholder, so falling back to it would undercount the priciest token class",
    );
  }
  return toSendResult(startUsage, deltaOutputTokens);
}

// Dispatches on the RESPONSE content-type, not on the request body's `stream`
// flag: a recording captures every /v1/messages call the agent made, and Claude
// Code issues non-streaming ones too. Guessing from the request would misparse
// those.
export function assembleUsage(input: { contentType: string; body: string }): SendResult {
  if (input.contentType.includes("text/event-stream")) return assembleSseUsage(input.body);

  let parsed: WireEvent;
  try {
    parsed = JSON.parse(input.body);
  } catch (cause) {
    throw new Error(
      `assembleUsage: response was neither SSE (content-type "${input.contentType}") nor parseable JSON: ${input.body.slice(0, 200)}`,
      { cause },
    );
  }
  if (parsed.type === "error") {
    throw new Error(
      `assembleUsage: the API returned an error (${String(parsed.error?.type ?? "unknown")}): ${String(parsed.error?.message ?? "")}`,
    );
  }
  if (parsed.usage === undefined) {
    throw new Error(
      "assembleUsage: response carried no usage block — there is no cost to attribute to this request",
    );
  }
  return toSendResult(parsed.usage, num(parsed.usage.output_tokens));
}
