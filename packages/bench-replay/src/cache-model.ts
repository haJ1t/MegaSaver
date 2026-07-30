import { createHash } from "node:crypto";
import type { RecordedRequest } from "./types.js";

// An offline model of what the API charges for a sequence of requests.
//
// It exists because A4's last open term — the input-side cost difference
// between the arms — needs a real API run, and the prompt cache is the one part
// of that run which is fully determined by data we already hold. It is a
// deterministic longest-prefix match, and we have both arms' exact bytes and
// exact breakpoint positions.
//
// WHAT THIS IS NOT: a measurement. The single input it cannot derive is
// bytes-per-token, so that is a required parameter rather than a buried
// constant, and it is calibrated against the recording's real end-to-end usage.
// Any figure derived from this must be labelled as modelled.
//
// Charging order per request, which is the whole model:
//   cache_read      the longest previously-cached prefix that still matches
//   cache_creation  from there to the LAST breakpoint in this request
//   input           everything after that breakpoint

export type CacheCost = {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

// One renderable piece of the prompt, in the order the API concatenates them.
type Segment = { text: string; breakpoint: boolean };

function hasCacheControl(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { cache_control?: unknown }).cache_control !== undefined &&
    (value as { cache_control?: unknown }).cache_control !== null
  );
}

// `cache_control` is a MARKER, not content, and it moves: request k puts it on
// its last turn and request k+1 moves it to the newer one. Hashing it as part of
// the block makes the same bytes look different between requests, so the entry
// request k created can never be matched again. Measured before this was
// excluded: the match froze at the system prefix (51,161 B) and never advanced
// into the messages for an entire 18-request session, modelling read/creation at
// 0.44 where the real session ran 11.8.
function segmentText(value: unknown): string {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const { cache_control: _marker, ...content } = value as Record<string, unknown>;
    return JSON.stringify(content);
  }
  return JSON.stringify(value ?? "");
}

// Claude Code injects a synthetic leading system block that is not prompt
// content — `x-anthropic-billing-header: cc_version=…; cch=…`. Its `cch` value
// changes on EVERY request, so if it participated in the cache key no prefix
// could ever match and cache_read would be 0 for the whole session. The
// recording's real usage is 945,296 read against 80,240 creation, which is only
// possible if the platform strips this block before the prompt is rendered.
// Excluded from both the key and the token count on that evidence.
function isBillingHeaderBlock(block: unknown): boolean {
  const text = (block as { text?: unknown }).text;
  return typeof text === "string" && text.startsWith("x-anthropic-billing-header:");
}

// tools -> system -> messages. The order is load-bearing: a breakpoint in
// `system` caches the tool definitions ahead of it too, so rendering them out of
// order would misprice every cached prefix in a recording that carries tools.
function segmentsOf(body: RecordedRequest): Segment[] {
  const segments: Segment[] = [];
  const holder = body as unknown as { tools?: unknown; system?: unknown };

  if (Array.isArray(holder.tools)) {
    for (const tool of holder.tools) {
      segments.push({ text: segmentText(tool), breakpoint: hasCacheControl(tool) });
    }
  }
  if (typeof holder.system === "string") {
    segments.push({ text: segmentText(holder.system), breakpoint: false });
  } else if (Array.isArray(holder.system)) {
    for (const block of holder.system) {
      if (isBillingHeaderBlock(block)) continue;
      segments.push({ text: segmentText(block), breakpoint: hasCacheControl(block) });
    }
  }
  for (const message of body.messages) {
    const content = (message as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const block of content) {
        segments.push({ text: segmentText(block), breakpoint: hasCacheControl(block) });
      }
    } else {
      segments.push({ text: segmentText(content), breakpoint: hasCacheControl(message) });
    }
  }
  return segments;
}

export function simulateCacheCost(
  bodies: readonly RecordedRequest[],
  options: { bytesPerToken: number },
): CacheCost {
  const { bytesPerToken } = options;
  if (!(bytesPerToken > 0)) {
    throw new Error(
      `simulateCacheCost: bytesPerToken must be positive, got ${bytesPerToken} — it is the model's one undetermined input and cannot be defaulted`,
    );
  }

  // Prefix hash -> tokens that prefix covers. A cached entry is keyed on the
  // EXACT bytes before it, which is why a diverged prefix cannot be read back.
  const cached = new Map<string, number>();
  const total: CacheCost = { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

  for (const body of bodies) {
    const segments = segmentsOf(body);
    const running = createHash("sha256");
    let bytes = 0;
    // Breakpoints in prefix order, each with the prefix hash and byte count it
    // would cache.
    const breakpoints: { hash: string; bytes: number }[] = [];

    // A cache entry is checked against the current prefix at EVERY segment
    // boundary, not only at this request's own breakpoints. That distinction is
    // the whole behaviour of a growing conversation: request k caches at its
    // last turn, and in request k+1 that position no longer carries
    // `cache_control` (it moved to the newer turn) — yet the entry is still a
    // prefix of k+1 and is still read back. Checking only the current
    // breakpoints modelled cache_read as 0 for an entire session whose real
    // read was 945,296 tokens.
    let readBytes = 0;
    for (const segment of segments) {
      bytes += Buffer.byteLength(segment.text, "utf8");
      // The CONTENT, not its length: a cache entry is keyed on exact bytes, so
      // hashing sizes alone would let two different prefixes of equal length
      // read each other's entries and invent savings that cannot happen.
      running.update(segment.text);
      const hash = running.copy().digest("hex");
      // Longest match wins: reading a shorter cached prefix when a longer one is
      // available would recharge bytes already paid for as creation.
      if (cached.has(hash)) readBytes = bytes;
      if (segment.breakpoint) breakpoints.push({ hash, bytes });
    }
    const lastBreakpointBytes = breakpoints.at(-1)?.bytes ?? 0;

    total.cacheReadTokens += Math.round(readBytes / bytesPerToken);
    total.cacheCreationTokens += Math.round((lastBreakpointBytes - readBytes) / bytesPerToken);
    total.inputTokens += Math.round((bytes - lastBreakpointBytes) / bytesPerToken);

    for (const bp of breakpoints) cached.set(bp.hash, bp.bytes);
  }
  return total;
}
