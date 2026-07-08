// packages/pro-analytics/src/cache-doctor.ts
import { INPUT_PRICE_PER_MTOK_USD } from "@megasaver/stats";

export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;
export const MIN_CACHEABLE_TOKENS = 1024;
export const CACHE_TTL_MS = 300_000;
export const CHAIN_GAP_MAX_MS = 3_600_000;
export const D1_MIN_TOTAL_INPUT = 10_000;
export const RELIABLE_MIN_EVENTS = 20;
export const RELIABLE_MIN_CONVERSATIONS = 3;

// Structural mirror of llm-proxy's ProxyUsageEvent (minus id/stream) so
// pro-analytics gains no llm-proxy dependency edge — the same hygiene stats
// used for ProxyUsageTokenCounts. ProxyUsageEvent is assignable to it.
export interface CacheUsageEvent {
  ts: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  messageCount: number;
}

export type CacheDetector = "no-cache" | "unstable-prefix" | "ttl-expiry" | "model-switch";

export interface CacheFinding {
  detector: CacheDetector;
  conversations: number;
  occurrences: number;
  missedTokens: number;
  burnedUsd: number;
  advice: string;
}

export interface CacheDoctorReport {
  windowDays: number;
  since: string;
  until: string;
  calls: number;
  conversations: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  hitRate: number;
  findings: CacheFinding[];
  burnedUsdTotal: number;
  reliable: boolean;
}

export const CACHE_ADVICE: Record<CacheDetector, string> = {
  "no-cache":
    "enable prompt caching in your client (cache_control on the system prompt/tools) — repeated prefixes are re-billed at full price every turn",
  "unstable-prefix":
    "keep the prompt prefix byte-stable across turns (system prompt, tool definitions, early messages) — any edit or reorder above the cache point rewrites everything after it",
  "ttl-expiry":
    "gaps over 5 min expire the cache; batch follow-ups within the TTL or use the 1-hour cache option",
  "model-switch":
    "switching models mid-conversation abandons the cache (it is per-model); switch at conversation boundaries",
};

// A conversation is a maximal chain of calls whose messageCount strictly grows
// with gaps ≤ CHAIN_GAP_MAX_MS. Model changes do NOT break the chain — D4
// prices exactly that case. Heuristic by design (counts-only log): interleaved
// parallel conversations can mis-group; the report's `reliable` flag and the
// render footer disclose it.
export function groupConversations(events: readonly CacheUsageEvent[]): CacheUsageEvent[][] {
  const sorted = [...events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const groups: CacheUsageEvent[][] = [];
  let current: CacheUsageEvent[] = [];
  let prev: CacheUsageEvent | undefined;
  for (const e of sorted) {
    const breaks =
      prev !== undefined &&
      (e.messageCount <= prev.messageCount ||
        Date.parse(e.ts) - Date.parse(prev.ts) > CHAIN_GAP_MAX_MS);
    if (breaks) {
      groups.push(current);
      current = [];
    }
    current.push(e);
    prev = e;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
