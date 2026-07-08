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

export interface TurnMiss {
  detector: Exclude<CacheDetector, "no-cache">;
  rePaidTokens: number;
  burnedUsd: number;
}

export interface ConversationDiagnosis {
  d1: { missedTokens: number; burnedUsd: number } | null;
  turnMisses: TurnMiss[];
}

// Turn 1 is exempt everywhere: the first cache write is the legitimate price
// of admission, and priorWritten is 0 there anyway.
export function diagnoseConversation(
  convo: readonly CacheUsageEvent[],
  perTokenUsd: number,
): ConversationDiagnosis {
  const first = convo[0];
  const second = convo[1];
  if (first === undefined || second === undefined) return { d1: null, turnMisses: [] };

  const zeroCache = convo.every((e) => e.cacheReadTokens === 0 && e.cacheCreationTokens === 0);
  const totalInput = convo.reduce((sum, e) => sum + e.inputTokens, 0);

  if (zeroCache && totalInput >= D1_MIN_TOTAL_INPUT) {
    // Counts-only cannot see the true shared prefix; min() of consecutive
    // input loads is a conservative floor for what caching would have reused.
    let missed = 0;
    let prevTurn = first;
    for (const cur of convo.slice(1)) {
      missed += Math.min(cur.inputTokens, prevTurn.inputTokens);
      prevTurn = cur;
    }
    // Credit the one-time cache-write premium the client never paid. `missed`
    // always ≥ this premium base and 0.9 > 0.25, so the result is already
    // non-negative; the max(0,…) is a display-contract guard on a user-facing
    // dollar figure, not a reachable branch.
    const premium =
      Math.min(second.inputTokens, first.inputTokens) * perTokenUsd * (CACHE_WRITE_MULTIPLIER - 1);
    const burnedUsd = Math.max(0, missed * perTokenUsd * (1 - CACHE_READ_MULTIPLIER) - premium);
    return { d1: { missedTokens: missed, burnedUsd }, turnMisses: [] };
  }

  const turnMisses: TurnMiss[] = [];
  let priorWritten = first.cacheCreationTokens;
  let prevTurn = first;
  for (const cur of convo.slice(1)) {
    const triggered =
      priorWritten >= MIN_CACHEABLE_TOKENS &&
      cur.cacheReadTokens < MIN_CACHEABLE_TOKENS &&
      cur.cacheCreationTokens >= MIN_CACHEABLE_TOKENS;
    if (triggered) {
      // Only the re-paid portion is waste: writing NEW content to cache is
      // normal, so cap at what the conversation had already written.
      const rePaidTokens = Math.min(cur.cacheCreationTokens, priorWritten);
      const detector: TurnMiss["detector"] =
        cur.model !== prevTurn.model
          ? "model-switch"
          : Date.parse(cur.ts) - Date.parse(prevTurn.ts) > CACHE_TTL_MS
            ? "ttl-expiry"
            : "unstable-prefix";
      turnMisses.push({
        detector,
        rePaidTokens,
        burnedUsd: rePaidTokens * perTokenUsd * (CACHE_WRITE_MULTIPLIER - CACHE_READ_MULTIPLIER),
      });
    }
    priorWritten += cur.cacheCreationTokens;
    prevTurn = cur;
  }
  return { d1: null, turnMisses };
}
