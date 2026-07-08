// packages/pro-analytics/test/cache-doctor.test.ts
import { describe, expect, it } from "vitest";
import {
  CACHE_TTL_MS,
  CHAIN_GAP_MAX_MS,
  type CacheUsageEvent,
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
