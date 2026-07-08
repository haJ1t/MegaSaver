// packages/pro-analytics/test/cache-doctor.test.ts
import { describe, expect, it } from "vitest";
import {
  CACHE_TTL_MS,
  CHAIN_GAP_MAX_MS,
  type CacheUsageEvent,
  D1_MIN_TOTAL_INPUT,
  MIN_CACHEABLE_TOKENS,
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
