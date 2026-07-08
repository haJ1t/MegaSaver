// packages/pro-analytics/test/cache-doctor.test.ts
import { describe, expect, it } from "vitest";
import {
  CACHE_ADVICE,
  CACHE_TTL_MS,
  CHAIN_GAP_MAX_MS,
  type CacheUsageEvent,
  D1_MIN_TOTAL_INPUT,
  MIN_CACHEABLE_TOKENS,
  RELIABLE_MIN_CONVERSATIONS,
  RELIABLE_MIN_EVENTS,
  diagnoseCache,
  diagnoseConversation,
  groupConversations,
} from "../src/cache-doctor.js";

const T0 = Date.UTC(2026, 6, 8, 10, 0, 0);
// Event factory: sensible defaults, override what the case needs.
function ev(over: Partial<CacheUsageEvent> & { atMs: number }): CacheUsageEvent {
  const { atMs, ...rest } = over;
  return {
    ts: new Date(atMs).toISOString(),
    model: "claude-sonnet-5",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    messageCount: 1,
    ...rest,
  };
}

describe("groupConversations", () => {
  it("chains growing messageCount within the gap into one conversation", () => {
    const events = [
      ev({ atMs: T0, messageCount: 1 }),
      ev({ atMs: T0 + 60_000, messageCount: 3 }),
      ev({ atMs: T0 + 120_000, messageCount: 5 }),
    ];
    expect(groupConversations(events).map((g) => g.length)).toEqual([3]);
  });

  it("a messageCount reset starts a new conversation", () => {
    const events = [ev({ atMs: T0, messageCount: 5 }), ev({ atMs: T0 + 60_000, messageCount: 1 })];
    expect(groupConversations(events).map((g) => g.length)).toEqual([1, 1]);
  });

  it("an equal messageCount breaks the chain (counts strictly grow)", () => {
    const events = [ev({ atMs: T0, messageCount: 3 }), ev({ atMs: T0 + 60_000, messageCount: 3 })];
    expect(groupConversations(events).map((g) => g.length)).toEqual([1, 1]);
  });

  it("a gap over CHAIN_GAP_MAX_MS breaks; exactly at the limit does not", () => {
    const atLimit = [
      ev({ atMs: T0, messageCount: 1 }),
      ev({ atMs: T0 + CHAIN_GAP_MAX_MS, messageCount: 3 }),
    ];
    expect(groupConversations(atLimit).map((g) => g.length)).toEqual([2]);
    const over = [
      ev({ atMs: T0, messageCount: 1 }),
      ev({ atMs: T0 + CHAIN_GAP_MAX_MS + 1, messageCount: 3 }),
    ];
    expect(groupConversations(over).map((g) => g.length)).toEqual([1, 1]);
  });

  it("a model change does NOT break the chain (D4's job)", () => {
    const events = [
      ev({ atMs: T0, messageCount: 1, model: "claude-sonnet-5" }),
      ev({ atMs: T0 + 60_000, messageCount: 3, model: "claude-opus-4-8" }),
    ];
    expect(groupConversations(events).map((g) => g.length)).toEqual([2]);
  });

  it("sorts by ts before grouping", () => {
    const events = [ev({ atMs: T0 + 60_000, messageCount: 3 }), ev({ atMs: T0, messageCount: 1 })];
    const groups = groupConversations(events);
    expect(groups.map((g) => g.length)).toEqual([2]);
    expect(groups[0]?.[0]?.messageCount).toBe(1);
  });
});

const PER_TOKEN = 3 / 1e6;

describe("diagnoseConversation — D1 no-cache", () => {
  it("fires on a ≥2-turn zero-cache conversation over the input floor", () => {
    const convo = [
      ev({ atMs: T0, messageCount: 1, inputTokens: 10_000 }),
      ev({ atMs: T0 + 60_000, messageCount: 3, inputTokens: 12_000 }),
      ev({ atMs: T0 + 120_000, messageCount: 5, inputTokens: 11_000 }),
    ];
    const r = diagnoseConversation(convo, PER_TOKEN);
    // missed = min(12000,10000) + min(11000,12000) = 21000
    expect(r.d1?.missedTokens).toBe(21_000);
    // burned = 21000·P·0.9 − min(12000,10000)·P·0.25 = 0.0567 − 0.0075
    expect(r.d1?.burnedUsd).toBeCloseTo(0.0492, 6);
    expect(r.turnMisses).toEqual([]);
  });

  it("does not fire below the input floor, on 1-turn convos, or with any cache activity", () => {
    const small = [
      ev({ atMs: T0, messageCount: 1, inputTokens: 4_000 }),
      ev({ atMs: T0 + 60_000, messageCount: 3, inputTokens: 5_000 }),
    ];
    expect(diagnoseConversation(small, PER_TOKEN).d1).toBeNull();
    const single = [ev({ atMs: T0, messageCount: 1, inputTokens: 50_000 })];
    expect(diagnoseConversation(single, PER_TOKEN).d1).toBeNull();
    const cached = [
      ev({ atMs: T0, messageCount: 1, inputTokens: 10_000, cacheCreationTokens: 2_000 }),
      ev({ atMs: T0 + 60_000, messageCount: 3, inputTokens: 12_000 }),
    ];
    expect(diagnoseConversation(cached, PER_TOKEN).d1).toBeNull();
  });

  it("D1 burn is structurally non-negative (write-premium credit never exceeds read savings)", () => {
    const convo = [
      ev({ atMs: T0, messageCount: 1, inputTokens: 41_000 }),
      ev({ atMs: T0 + 60_000, messageCount: 3, inputTokens: 10_000 }),
    ];
    const r = diagnoseConversation(convo, PER_TOKEN);
    // missed = min(10000,41000) = 10000; premium base = min(10000,41000) = 10000.
    // burned = 10000·P·0.9 − 10000·P·0.25 = 10000·P·0.65. The premium base can
    // never exceed `missed` and 0.9 > 0.25, so burnedUsd is always ≥ 0 — the
    // max(0,…) is a display-contract guard, not a reachable branch.
    expect(r.d1?.missedTokens).toBe(10_000);
    expect(r.d1?.burnedUsd).toBeCloseTo(10_000 * PER_TOKEN * 0.65, 10);
    expect(r.d1?.burnedUsd).toBeGreaterThan(0);
  });
});

describe("diagnoseConversation — D2/D3/D4 turn misses", () => {
  const base = { messageCount: 1, cacheCreationTokens: 5_000 };
  it("re-write within the TTL with a stable model is unstable-prefix", () => {
    const convo = [
      ev({ atMs: T0, ...base }),
      ev({ atMs: T0 + 60_000, messageCount: 3, cacheCreationTokens: 5_000 }),
    ];
    expect(diagnoseConversation(convo, PER_TOKEN).turnMisses).toEqual([
      { detector: "unstable-prefix", rePaidTokens: 5_000, burnedUsd: 5_000 * PER_TOKEN * 1.15 },
    ]);
  });

  it("a gap strictly over CACHE_TTL_MS classifies as ttl-expiry; exactly at it stays unstable-prefix", () => {
    const at = diagnoseConversation(
      [
        ev({ atMs: T0, ...base }),
        ev({ atMs: T0 + CACHE_TTL_MS, messageCount: 3, cacheCreationTokens: 5_000 }),
      ],
      PER_TOKEN,
    );
    expect(at.turnMisses[0]?.detector).toBe("unstable-prefix");
    const over = diagnoseConversation(
      [
        ev({ atMs: T0, ...base }),
        ev({ atMs: T0 + CACHE_TTL_MS + 1, messageCount: 3, cacheCreationTokens: 5_000 }),
      ],
      PER_TOKEN,
    );
    expect(over.turnMisses[0]?.detector).toBe("ttl-expiry");
  });

  it("a model change wins over the gap (priority D4 > D3)", () => {
    const convo = [
      ev({ atMs: T0, ...base, model: "claude-sonnet-5" }),
      ev({
        atMs: T0 + CACHE_TTL_MS + 60_000,
        messageCount: 3,
        cacheCreationTokens: 5_000,
        model: "claude-opus-4-8",
      }),
    ];
    expect(diagnoseConversation(convo, PER_TOKEN).turnMisses[0]?.detector).toBe("model-switch");
  });

  it("respects the 1024 boundaries: creation 1023, read 1024, priorWritten 1023 all suppress", () => {
    const creationLow = [
      ev({ atMs: T0, ...base }),
      ev({ atMs: T0 + 60_000, messageCount: 3, cacheCreationTokens: 1_023 }),
    ];
    expect(diagnoseConversation(creationLow, PER_TOKEN).turnMisses).toEqual([]);
    const readHigh = [
      ev({ atMs: T0, ...base }),
      ev({
        atMs: T0 + 60_000,
        messageCount: 3,
        cacheCreationTokens: 5_000,
        cacheReadTokens: 1_024,
      }),
    ];
    expect(diagnoseConversation(readHigh, PER_TOKEN).turnMisses).toEqual([]);
    const priorLow = [
      ev({ atMs: T0, messageCount: 1, cacheCreationTokens: 1_023 }),
      ev({ atMs: T0 + 60_000, messageCount: 3, cacheCreationTokens: 5_000 }),
    ];
    expect(diagnoseConversation(priorLow, PER_TOKEN).turnMisses).toEqual([]);
  });

  it("fires at exactly the 1024 boundaries (>= not >): read 1023, creation 1024, priorWritten 1024", () => {
    const convo = [
      ev({ atMs: T0, messageCount: 1, cacheCreationTokens: 1_024 }),
      ev({
        atMs: T0 + 60_000,
        messageCount: 3,
        cacheReadTokens: 1_023,
        cacheCreationTokens: 1_024,
      }),
    ];
    expect(diagnoseConversation(convo, PER_TOKEN).turnMisses).toEqual([
      { detector: "unstable-prefix", rePaidTokens: 1_024, burnedUsd: 1_024 * PER_TOKEN * 1.15 },
    ]);
  });

  it("caps rePaid at priorWritten — new-content writes are never counted", () => {
    const convo = [
      ev({ atMs: T0, messageCount: 1, cacheCreationTokens: 2_000 }),
      ev({ atMs: T0 + 60_000, messageCount: 3, cacheCreationTokens: 50_000 }),
    ];
    expect(diagnoseConversation(convo, PER_TOKEN).turnMisses[0]?.rePaidTokens).toBe(2_000);
  });

  it("turn 1 is never flagged and a healthy read-heavy turn is not flagged", () => {
    const healthy = [
      ev({ atMs: T0, messageCount: 1, cacheCreationTokens: 8_000 }),
      ev({ atMs: T0 + 60_000, messageCount: 3, cacheReadTokens: 8_000, cacheCreationTokens: 600 }),
    ];
    expect(diagnoseConversation(healthy, PER_TOKEN).turnMisses).toEqual([]);
  });
});

describe("diagnoseCache", () => {
  const NOW = T0 + 3 * 86_400_000;

  it("filters the window, totals, and computes hitRate", () => {
    const events = [
      ev({ atMs: NOW - 8 * 86_400_000, messageCount: 1, inputTokens: 999_999 }), // outside 7d
      ev({ atMs: T0, messageCount: 1, inputTokens: 1_000, cacheCreationTokens: 4_000 }),
      ev({
        atMs: T0 + 60_000,
        messageCount: 3,
        inputTokens: 500,
        cacheReadTokens: 4_000,
        cacheCreationTokens: 500,
      }),
    ];
    const r = diagnoseCache(events, { now: NOW });
    expect(r.calls).toBe(2);
    expect(r.conversations).toBe(1);
    expect(r.inputTokens).toBe(1_500);
    expect(r.cacheReadTokens).toBe(4_000);
    expect(r.cacheCreationTokens).toBe(4_500);
    // hitRate = 4000 / (1500 + 4000 + 4500)
    expect(r.hitRate).toBeCloseTo(0.4, 6);
    expect(r.windowDays).toBe(7);
    expect(r.findings).toEqual([]);
    expect(r.burnedUsdTotal).toBe(0);
  });

  it("hitRate is 0 on an empty window (no NaN)", () => {
    const r = diagnoseCache([], { now: NOW });
    expect(r.calls).toBe(0);
    expect(r.hitRate).toBe(0);
    expect(r.reliable).toBe(false);
  });

  it("aggregates findings per detector in D1..D4 order with advice", () => {
    // Convo A: D1 (2 turns, zero cache, 20K input). Convo B: one
    // unstable-prefix turn. Convo C: one model-switch turn.
    const events = [
      ev({ atMs: T0, messageCount: 1, inputTokens: 10_000 }),
      ev({ atMs: T0 + 60_000, messageCount: 3, inputTokens: 10_000 }),
      ev({ atMs: T0 + 7_200_000, messageCount: 1, cacheCreationTokens: 5_000 }),
      ev({ atMs: T0 + 7_260_000, messageCount: 3, cacheCreationTokens: 5_000 }),
      ev({ atMs: T0 + 14_400_000, messageCount: 1, cacheCreationTokens: 2_000, model: "a" }),
      ev({ atMs: T0 + 14_460_000, messageCount: 3, cacheCreationTokens: 2_000, model: "b" }),
    ];
    const r = diagnoseCache(events, { now: NOW });
    expect(r.conversations).toBe(3);
    expect(r.findings.map((f) => f.detector)).toEqual([
      "no-cache",
      "unstable-prefix",
      "model-switch",
    ]);
    const d1 = r.findings[0];
    expect(d1?.conversations).toBe(1);
    expect(d1?.occurrences).toBe(1);
    expect(d1?.missedTokens).toBe(10_000);
    expect(d1?.advice).toBe(CACHE_ADVICE["no-cache"]);
    const d2 = r.findings[1];
    expect(d2?.occurrences).toBe(1);
    expect(d2?.missedTokens).toBe(5_000);
    // Pin the exact per-finding dollars (the total assertion below is otherwise
    // tautological — burnedUsdTotal is the sum of these by construction).
    expect(r.findings[0]?.burnedUsd).toBeCloseTo(10_000 * PER_TOKEN * 0.65, 10); // D1 no-cache
    expect(r.findings[1]?.burnedUsd).toBeCloseTo(5_000 * PER_TOKEN * 1.15, 10); // unstable-prefix
    expect(r.findings[2]?.burnedUsd).toBeCloseTo(2_000 * PER_TOKEN * 1.15, 10); // model-switch
    expect(r.burnedUsdTotal).toBeCloseTo(
      (r.findings[0]?.burnedUsd ?? 0) +
        (r.findings[1]?.burnedUsd ?? 0) +
        (r.findings[2]?.burnedUsd ?? 0),
      10,
    );
  });

  it("reliable needs ≥20 windowed events AND ≥3 conversations", () => {
    // 20 events in 3 conversations → reliable.
    const many: CacheUsageEvent[] = [];
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < (c === 0 ? 18 : 1); i++) {
        many.push(ev({ atMs: T0 + c * 7_200_000 + i * 60_000, messageCount: i + 1 }));
      }
    }
    expect(many).toHaveLength(20);
    expect(diagnoseCache(many, { now: NOW }).reliable).toBe(true);
    expect(diagnoseCache(many.slice(1), { now: NOW }).reliable).toBe(false); // 19 events
    // 20 events but 2 conversations → false.
    const twoConvos: CacheUsageEvent[] = [];
    for (let i = 0; i < 19; i++) twoConvos.push(ev({ atMs: T0 + i * 60_000, messageCount: i + 1 }));
    twoConvos.push(ev({ atMs: T0 + 7_200_000, messageCount: 1 }));
    expect(diagnoseCache(twoConvos, { now: NOW }).reliable).toBe(false);
  });

  it("respects a priceUsd override in the burn math", () => {
    const events = [
      ev({ atMs: T0, messageCount: 1, cacheCreationTokens: 5_000 }),
      ev({ atMs: T0 + 60_000, messageCount: 3, cacheCreationTokens: 5_000 }),
    ];
    const r = diagnoseCache(events, { now: NOW, priceUsd: 30 });
    expect(r.findings[0]?.burnedUsd).toBeCloseTo(5_000 * (30 / 1e6) * 1.15, 10);
  });
});
