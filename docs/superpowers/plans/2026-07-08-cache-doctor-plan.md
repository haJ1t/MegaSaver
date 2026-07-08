# Prompt-Cache Doctor (`mega cache`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Pro module 9 — a gated `mega cache` command that reads the metering proxy's counts-only `usage.jsonl`, detects four prompt-cache-miss signatures, prices the burn in dollars, and prints one-line fixes.

**Architecture:** A pure analyzer (`diagnoseCache`) in `@megasaver/pro-analytics` takes structurally-typed usage events and returns a `CacheDoctorReport`; the CLI command owns all I/O (entitlement gate, tolerant JSONL read via a newly-exported llm-proxy path helper, render). No new dependency edges: pro-analytics already depends on stats (price const); apps/cli already depends on llm-proxy.

**Tech Stack:** TypeScript strict ESM, Vitest, citty, zod (boundary only, in CLI).

**Spec:** `docs/superpowers/specs/2026-07-08-cache-doctor-design.md` (risk HIGH — code-reviewer + critic before merge).

## File structure

- Modify: `packages/llm-proxy/src/store.ts` — export `proxyUsageLogPath`
- Modify: `packages/llm-proxy/src/index.ts` — re-export it
- Create: `packages/llm-proxy/test/usage-log-path.test.ts`
- Create: `packages/pro-analytics/src/cache-doctor.ts` — pure analyzer (types, constants, grouping, detectors, report)
- Modify: `packages/pro-analytics/src/index.ts` — re-export public surface
- Create: `packages/pro-analytics/test/cache-doctor.test.ts`
- Create: `apps/cli/src/commands/cache.ts` — `mega cache`
- Modify: `apps/cli/src/main.ts` — register
- Create: `apps/cli/test/commands/cache.test.ts`
- Modify: `README.md`, Create: `.changeset/cache-doctor.md`, Modify: `wiki/entities/cli.md` + `wiki/log.md` (Task 8)

All work happens in the worktree `.claude/worktrees/feat-cli-mega-cache` (branch `feat/cli-mega-cache`). Run tests from the package dir with `npx vitest run <file>`; full gate is `pnpm verify` at the end.

---

### Task 1: llm-proxy — export the usage-log path helper

The CLI needs the log's location without llm-proxy's strict reader (`listProxyUsage` throws on a corrupt line; the doctor must skip-and-continue).

**Files:**
- Modify: `packages/llm-proxy/src/store.ts`
- Modify: `packages/llm-proxy/src/index.ts`
- Create: `packages/llm-proxy/test/usage-log-path.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/llm-proxy/test/usage-log-path.test.ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { proxyUsageLogPath } from "../src/index.js";

describe("proxyUsageLogPath", () => {
  it("locates usage.jsonl under proxy-usage in the store root", () => {
    expect(proxyUsageLogPath("/tmp/store")).toBe(join("/tmp/store", "proxy-usage", "usage.jsonl"));
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`proxyUsageLogPath` not exported)

Run: `cd packages/llm-proxy && npx vitest run test/usage-log-path.test.ts`

- [ ] **Step 3: Implement**

In `packages/llm-proxy/src/store.ts`, rename the private `usagePath` to an exported `proxyUsageLogPath` (update its two internal call sites in `appendProxyUsage` and `listProxyUsage`):

```ts
// The usage log's canonical location. Exported so read-only consumers (the
// cache doctor) can do their own tolerant per-line parse — listProxyUsage is
// strict by design and throws on a corrupt line.
export function proxyUsageLogPath(storeRoot: string): string {
  return join(storeRoot, "proxy-usage", "usage.jsonl");
}
```

In `packages/llm-proxy/src/index.ts` extend the store re-export line:

```ts
export { appendProxyUsage, listProxyUsage, proxyUsageLogPath } from "./store.js";
```

- [ ] **Step 4: Run test + package tests — expect PASS**

Run: `cd packages/llm-proxy && npx vitest run`

- [ ] **Step 5: Commit**

```bash
git add packages/llm-proxy/src/store.ts packages/llm-proxy/src/index.ts packages/llm-proxy/test/usage-log-path.test.ts
git commit -m "feat(llm-proxy): export usage-log path helper"
```

---

### Task 2: cache-doctor — types, constants, conversation grouping

**Files:**
- Create: `packages/pro-analytics/src/cache-doctor.ts`
- Create: `packages/pro-analytics/test/cache-doctor.test.ts`

- [ ] **Step 1: Write the failing tests (grouping only)**

```ts
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
export function ev(over: Partial<CacheUsageEvent> & { atMs: number }): CacheUsageEvent {
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
    const events = [
      ev({ atMs: T0 + 60_000, messageCount: 3 }),
      ev({ atMs: T0, messageCount: 1 }),
    ];
    const groups = groupConversations(events);
    expect(groups.map((g) => g.length)).toEqual([2]);
    expect(groups[0]?.[0]?.messageCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module does not exist)

Run: `cd packages/pro-analytics && npx vitest run test/cache-doctor.test.ts`

- [ ] **Step 3: Implement types + constants + grouping**

```ts
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
      (e.messageCount <= prev.messageCount || Date.parse(e.ts) - Date.parse(prev.ts) > CHAIN_GAP_MAX_MS);
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
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/pro-analytics && npx vitest run test/cache-doctor.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/pro-analytics/src/cache-doctor.ts packages/pro-analytics/test/cache-doctor.test.ts
git commit -m "feat(pro-analytics): cache doctor grouping"
```

---

### Task 3: cache-doctor — per-conversation detectors

**Files:**
- Modify: `packages/pro-analytics/src/cache-doctor.ts`
- Modify: `packages/pro-analytics/test/cache-doctor.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `cache-doctor.test.ts` (import `diagnoseConversation`, `MIN_CACHEABLE_TOKENS`, `D1_MIN_TOTAL_INPUT` alongside the existing imports; `PER_TOKEN` is $3/MTok):

```ts
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

  it("clamps burnedUsd at zero", () => {
    // missed·0.9 (9000·P·0.9) < premium (10000·P·0.25) → clamp, not negative.
    const convo = [
      ev({ atMs: T0, messageCount: 1, inputTokens: 41_000 }),
      ev({ atMs: T0 + 60_000, messageCount: 3, inputTokens: 10_000 }),
    ];
    const r = diagnoseConversation(convo, PER_TOKEN);
    expect(r.d1?.missedTokens).toBe(10_000);
    expect(r.d1?.burnedUsd).toBe(0);
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
      [ev({ atMs: T0, ...base }), ev({ atMs: T0 + CACHE_TTL_MS, messageCount: 3, cacheCreationTokens: 5_000 })],
      PER_TOKEN,
    );
    expect(at.turnMisses[0]?.detector).toBe("unstable-prefix");
    const over = diagnoseConversation(
      [ev({ atMs: T0, ...base }), ev({ atMs: T0 + CACHE_TTL_MS + 1, messageCount: 3, cacheCreationTokens: 5_000 })],
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
      ev({ atMs: T0 + 60_000, messageCount: 3, cacheCreationTokens: 5_000, cacheReadTokens: 1_024 }),
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
```

- [ ] **Step 2: Run — expect FAIL** (`diagnoseConversation` not exported)

- [ ] **Step 3: Implement**

Append to `cache-doctor.ts`:

```ts
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
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/pro-analytics/src/cache-doctor.ts packages/pro-analytics/test/cache-doctor.test.ts
git commit -m "feat(pro-analytics): cache-miss detectors"
```

---

### Task 4: cache-doctor — `diagnoseCache` report assembly

**Files:**
- Modify: `packages/pro-analytics/src/cache-doctor.ts`
- Modify: `packages/pro-analytics/test/cache-doctor.test.ts`
- Modify: `packages/pro-analytics/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Append (import `diagnoseCache`, `RELIABLE_MIN_EVENTS`, `RELIABLE_MIN_CONVERSATIONS`, `CACHE_ADVICE`):

```ts
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
    expect(r.findings.map((f) => f.detector)).toEqual(["no-cache", "unstable-prefix", "model-switch"]);
    const d1 = r.findings[0];
    expect(d1?.conversations).toBe(1);
    expect(d1?.occurrences).toBe(1);
    expect(d1?.missedTokens).toBe(10_000);
    expect(d1?.advice).toBe(CACHE_ADVICE["no-cache"]);
    const d2 = r.findings[1];
    expect(d2?.occurrences).toBe(1);
    expect(d2?.missedTokens).toBe(5_000);
    expect(r.burnedUsdTotal).toBeCloseTo(
      (r.findings[0]?.burnedUsd ?? 0) + (r.findings[1]?.burnedUsd ?? 0) + (r.findings[2]?.burnedUsd ?? 0),
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
```

- [ ] **Step 2: Run — expect FAIL** (`diagnoseCache` not exported)

- [ ] **Step 3: Implement**

Append to `cache-doctor.ts`:

```ts
const DETECTOR_ORDER: readonly CacheDetector[] = [
  "no-cache",
  "unstable-prefix",
  "ttl-expiry",
  "model-switch",
];

export function diagnoseCache(
  events: readonly CacheUsageEvent[],
  opts: { now: number; days?: number; priceUsd?: number },
): CacheDoctorReport {
  const windowDays = opts.days ?? 7;
  const perTokenUsd = (opts.priceUsd ?? INPUT_PRICE_PER_MTOK_USD) / 1e6;
  const sinceMs = opts.now - windowDays * 86_400_000;
  const windowed = events.filter((e) => Date.parse(e.ts) >= sinceMs);
  const groups = groupConversations(windowed);

  const inputTokens = windowed.reduce((s, e) => s + e.inputTokens, 0);
  const cacheReadTokens = windowed.reduce((s, e) => s + e.cacheReadTokens, 0);
  const cacheCreationTokens = windowed.reduce((s, e) => s + e.cacheCreationTokens, 0);
  const totalLoad = inputTokens + cacheReadTokens + cacheCreationTokens;

  // Accumulate per detector across conversations. `conversations` counts
  // distinct convos affected; `occurrences` counts convos (D1) or turns (D2–4).
  const acc = new Map<CacheDetector, { convos: number; occ: number; missed: number; usd: number }>();
  const bump = (d: CacheDetector, occ: number, missed: number, usd: number) => {
    const row = acc.get(d) ?? { convos: 0, occ: 0, missed: 0, usd: 0 };
    row.convos += 1;
    row.occ += occ;
    row.missed += missed;
    row.usd += usd;
    acc.set(d, row);
  };
  for (const convo of groups) {
    const diag = diagnoseConversation(convo, perTokenUsd);
    if (diag.d1 !== null) bump("no-cache", 1, diag.d1.missedTokens, diag.d1.burnedUsd);
    for (const d of ["unstable-prefix", "ttl-expiry", "model-switch"] as const) {
      const misses = diag.turnMisses.filter((m) => m.detector === d);
      if (misses.length > 0)
        bump(
          d,
          misses.length,
          misses.reduce((s, m) => s + m.rePaidTokens, 0),
          misses.reduce((s, m) => s + m.burnedUsd, 0),
        );
    }
  }
  const findings: CacheFinding[] = DETECTOR_ORDER.flatMap((d) => {
    const row = acc.get(d);
    return row
      ? [
          {
            detector: d,
            conversations: row.convos,
            occurrences: row.occ,
            missedTokens: row.missed,
            burnedUsd: row.usd,
            advice: CACHE_ADVICE[d],
          },
        ]
      : [];
  });

  return {
    windowDays,
    since: new Date(sinceMs).toISOString(),
    until: new Date(opts.now).toISOString(),
    calls: windowed.length,
    conversations: groups.length,
    inputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    hitRate: totalLoad === 0 ? 0 : cacheReadTokens / totalLoad,
    findings,
    burnedUsdTotal: findings.reduce((s, f) => s + f.burnedUsd, 0),
    reliable: windowed.length >= RELIABLE_MIN_EVENTS && groups.length >= RELIABLE_MIN_CONVERSATIONS,
  };
}
```

Append to `packages/pro-analytics/src/index.ts`:

```ts
export {
  type CacheDetector,
  type CacheDoctorReport,
  type CacheFinding,
  type CacheUsageEvent,
  CACHE_ADVICE,
  CACHE_TTL_MS,
  MIN_CACHEABLE_TOKENS,
  diagnoseCache,
} from "./cache-doctor.js";
```

(`groupConversations` / `diagnoseConversation` stay package-internal exports for tests — imported via `../src/cache-doctor.js`, not the public entry.)

- [ ] **Step 4: Run package tests — expect PASS**

Run: `cd packages/pro-analytics && npx vitest run`

- [ ] **Step 5: Commit**

```bash
git add packages/pro-analytics/src/cache-doctor.ts packages/pro-analytics/src/index.ts packages/pro-analytics/test/cache-doctor.test.ts
git commit -m "feat(pro-analytics): cache doctor report"
```

---

### Task 5: CLI — `mega cache` command (gate, read, render)

**Files:**
- Create: `apps/cli/src/commands/cache.ts`
- Create: `apps/cli/test/commands/cache.test.ts`

- [ ] **Step 1: Write the failing tests**

Mirror `compress.test.ts`'s license plumbing (same `signTestLicense` helper, copied — it is 10 lines and test files stay self-contained):

```ts
// apps/cli/test/commands/cache.test.ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCache } from "../../src/commands/cache.js";

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW_MS = Date.UTC(2026, 6, 8, 12, 0, 0);
const now = () => NOW_MS;
const HOUR = 3_600_000;

function usageLine(over: Partial<Record<string, unknown>> & { atMs: number }): string {
  const { atMs, ...rest } = over;
  return JSON.stringify({
    id: "e1",
    ts: new Date(atMs).toISOString(),
    model: "claude-sonnet-5",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    messageCount: 1,
    stream: false,
    ...rest,
  });
}

let root: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-cache-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

function run(over: { log?: string | null; days?: string; json?: boolean } = {}) {
  const readUsageLog = vi.fn(() => (over.log === undefined ? null : over.log));
  const code = runCache({
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    readUsageLog,
    ...(over.days !== undefined ? { days: over.days } : {}),
    ...(over.json !== undefined ? { json: over.json } : {}),
    stdout,
    stderr,
  });
  return { code, readUsageLog };
}

describe("runCache — gating", () => {
  it("free tier: upsell, exit 0, log never read", async () => {
    const { code, readUsageLog } = run({ log: "" });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("mega license activate");
    expect(readUsageLog).not.toHaveBeenCalled();
  });
});

describe("runCache — entitled", () => {
  beforeEach(() => activatePro());

  it("no usage log → friendly note, exit 0", async () => {
    const { code } = run({ log: null });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("mega proxy");
  });

  it("empty window → same friendly note", async () => {
    const old = usageLine({ atMs: NOW_MS - 9 * 24 * HOUR });
    const { code } = run({ log: `${old}\n` });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("mega proxy");
  });

  it("skips malformed lines instead of crashing", async () => {
    const good = usageLine({ atMs: NOW_MS - HOUR, inputTokens: 2_000 });
    const log = `not json\n${good}\n{"half": true}\n`;
    const { code } = run({ log });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("Prompt-cache doctor");
    expect(out.join("\n")).toContain("calls 1");
  });

  it("rejects invalid --days at the boundary", async () => {
    for (const bad of ["0", "-3", "x", "1.5"]) {
      err = [];
      const { code } = run({ log: "", days: bad });
      expect(await code).toBe(1);
      expect(err.join("\n")).toContain("--days");
    }
  });

  it("--json emits the raw report", async () => {
    const good = usageLine({ atMs: NOW_MS - HOUR });
    const { code } = run({ log: `${good}\n`, json: true });
    expect(await code).toBe(0);
    const report = JSON.parse(out.join("\n")) as { calls: number; windowDays: number };
    expect(report.calls).toBe(1);
    expect(report.windowDays).toBe(7);
  });

  it("healthy data renders the healthy line, no burn headline", async () => {
    const lines = [
      usageLine({ atMs: NOW_MS - 2 * HOUR, messageCount: 1, cacheCreationTokens: 8_000 }),
      usageLine({
        atMs: NOW_MS - 2 * HOUR + 60_000,
        messageCount: 3,
        cacheReadTokens: 8_000,
        cacheCreationTokens: 200,
      }),
    ];
    const { code } = run({ log: `${lines.join("\n")}\n` });
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("cache healthy");
    expect(out.join("\n")).not.toContain("burned on cache misses");
  });

  it("findings render tokens, dollars, and the fix line; thin data suppresses the headline", async () => {
    // One unstable-prefix miss: two calls, 5000 write then 5000 re-write.
    const lines = [
      usageLine({ atMs: NOW_MS - 2 * HOUR, messageCount: 1, cacheCreationTokens: 5_000 }),
      usageLine({
        atMs: NOW_MS - 2 * HOUR + 60_000,
        messageCount: 3,
        cacheCreationTokens: 5_000,
      }),
    ];
    const { code } = run({ log: `${lines.join("\n")}\n` });
    expect(await code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("unstable-prefix");
    expect(text).toContain("5000 tokens re-paid");
    expect(text).toContain("fix: keep the prompt prefix byte-stable");
    // 2 calls / 1 conversation → unreliable → headline suppressed, caveat shown.
    expect(text).not.toContain("burned on cache misses");
    expect(text).toContain("not enough data for a confident diagnosis");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module does not exist)

Run: `cd apps/cli && npx vitest run test/commands/cache.test.ts`

- [ ] **Step 3: Implement**

```ts
// apps/cli/src/commands/cache.ts
import type { KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkEntitlement } from "@megasaver/entitlement";
import { type ProxyUsageEvent, proxyUsageEventSchema, proxyUsageLogPath } from "@megasaver/llm-proxy";
import { INPUT_PRICE_PER_MTOK_USD } from "@megasaver/stats";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { PRO_ANALYTICS_URL } from "./savings/index.js";

export const CACHE_UPSELL = `The prompt-cache doctor is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

export const NO_USAGE_NOTE =
  "no proxy usage recorded — enable metering with `mega proxy` and route your agent through it";

// Boundary parse (§8): the window drives date arithmetic downstream.
export function parseDays(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export type RunCacheInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  days?: string;
  json?: boolean;
  // Returns the raw usage.jsonl text, or null when the log does not exist.
  readUsageLog: (storeRoot: string) => string | null;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export function defaultReadUsageLog(storeRoot: string): string | null {
  try {
    return readFileSync(proxyUsageLogPath(storeRoot), "utf8");
  } catch {
    return null;
  }
}

export async function runCache(input: RunCacheInput): Promise<0 | 1> {
  // Gate FIRST: the Pro compute must never half-run for a free user.
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(CACHE_UPSELL);
    return 0;
  }

  let days: number | undefined;
  if (input.days !== undefined) {
    const parsed = parseDays(input.days);
    if (parsed === null) {
      input.stderr(`Invalid --days ${input.days}: expected a whole number of days ≥ 1.`);
      return 1;
    }
    days = parsed;
  }

  const raw = input.readUsageLog(input.storeRoot);
  if (raw === null) {
    input.stdout(NO_USAGE_NOTE);
    return 0;
  }

  const events: ProxyUsageEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(trimmed);
    } catch {
      continue; // a corrupt tail from a crashed writer must not kill the report
    }
    const result = proxyUsageEventSchema.safeParse(parsedLine);
    if (result.success) events.push(result.data);
  }

  const { diagnoseCache } = await import("@megasaver/pro-analytics");
  const report = diagnoseCache(events, {
    now: input.now(),
    ...(days === undefined ? {} : { days }),
  });

  if (report.calls === 0) {
    input.stdout(NO_USAGE_NOTE);
    return 0;
  }

  if (input.json) {
    input.stdout(JSON.stringify(report));
    return 0;
  }

  const pct = `${Math.round(report.hitRate * 100)}%`;
  input.stdout(`Prompt-cache doctor — last ${report.windowDays} days`);
  input.stdout(
    `calls ${report.calls} · conversations ${report.conversations} · cache hit rate ${pct}`,
  );
  if (report.findings.length === 0) {
    input.stdout(`cache healthy — hit rate ${pct}, nothing burned`);
    return 0;
  }
  if (report.reliable) {
    input.stdout(`$${report.burnedUsdTotal.toFixed(2)} burned on cache misses`);
  } else {
    input.stdout(
      `not enough data for a confident diagnosis (${report.calls} calls, ${report.conversations} conversations) — counts below are indicative only`,
    );
  }
  input.stdout("");
  for (const f of report.findings) {
    input.stdout(
      `${f.detector}  ${f.conversations} conversation(s) · ${f.occurrences} occurrence(s) · ${f.missedTokens} tokens re-paid · ~$${f.burnedUsd.toFixed(2)}`,
    );
    input.stdout(`  fix: ${f.advice}`);
  }
  input.stdout("");
  input.stdout("(conversation grouping is a counts-only heuristic; parallel sessions can blur it)");
  input.stdout(
    `(est. at $${INPUT_PRICE_PER_MTOK_USD}/M input; cache write billed at 1.25x, cache read at 0.1x.)`,
  );
  return 0;
}
```

Notes: `ProxyUsageEvent` is structurally assignable to pro-analytics' `CacheUsageEvent` (extra `id`/`stream` fields are fine); the price footer derives from `INPUT_PRICE_PER_MTOK_USD` so it can never drift from the constant.

Then the command definition, same file:

```ts
export const cacheCommand = defineCommand({
  meta: {
    name: "cache",
    description:
      "Prompt-cache doctor — detect cache misses, the dollars they burned, and how to fix them (Mega Saver Pro).",
  },
  args: {
    days: { type: "string", description: "Window in days (default: 7)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runCache({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      now: () => Date.now(),
      ...(typeof args.days === "string" ? { days: args.days } : {}),
      json: !!args.json,
      readUsageLog: defaultReadUsageLog,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd apps/cli && npx vitest run test/commands/cache.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/cache.ts apps/cli/test/commands/cache.test.ts
git commit -m "feat(cli): mega cache command"
```

---

### Task 6: register + real-fs smoke

**Files:**
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/test/commands/cache.test.ts`

- [ ] **Step 1: Write the failing real-fs test**

Append to `cache.test.ts` (imports: add `writeFileSync`, `mkdirSync` to the node:fs import):

```ts
  it("real-fs smoke: default reader finds the store log and prices a known miss", async () => {
    const { defaultReadUsageLog } = await import("../../src/commands/cache.js");
    const dir = join(root, "proxy-usage");
    mkdirSync(dir, { recursive: true });
    const lines = [
      usageLine({ atMs: NOW_MS - 2 * HOUR, messageCount: 1, cacheCreationTokens: 10_000 }),
      usageLine({
        atMs: NOW_MS - 2 * HOUR + 60_000,
        messageCount: 3,
        cacheCreationTokens: 10_000,
      }),
    ];
    writeFileSync(join(dir, "usage.jsonl"), `${lines.join("\n")}\n`);
    const code = await runCache({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readUsageLog: defaultReadUsageLog,
      json: true,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const report = JSON.parse(out.join("\n")) as {
      findings: Array<{ detector: string; burnedUsd: number }>;
    };
    expect(report.findings[0]?.detector).toBe("unstable-prefix");
    // 10000 re-paid × $3/MTok × 1.15
    expect(report.findings[0]?.burnedUsd).toBeCloseTo(0.0345, 6);
  });
```

- [ ] **Step 2: Run — expect PASS for the smoke (defaultReadUsageLog already exists); verify registration is still missing**

Run: `cd apps/cli && npx vitest run test/commands/cache.test.ts`
Then: `grep -n "cacheCommand" src/main.ts` → no match yet.

- [ ] **Step 3: Register in `apps/cli/src/main.ts`**

Add the import after `benchCommand` (alphabetical):

```ts
import { cacheCommand } from "./commands/cache.js";
```

Add to `subCommands` after `bench`:

```ts
    cache: cacheCommand,
```

- [ ] **Step 4: Run the full cli test suite — expect PASS** (registration tests like enum/audit pins may assert the command list; update them only if they fail and the failure is a deliberate-surface pin — e.g. `apps/cli/test/rules.test.ts` or help-text snapshots — by adding `cache` where the test enumerates commands)

Run: `cd apps/cli && npx vitest run`

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/main.ts apps/cli/test/commands/cache.test.ts
git commit -m "feat(cli): register cache command"
```

---

### Task 7: full verify + smoke evidence

- [ ] **Step 1: Run the DoD gate**

Run from the worktree root: `pnpm verify`
Expected: lint + typecheck + all tests + conventions:check green.

- [ ] **Step 2: CLI smoke (captured terminal evidence, DoD §9.5)**

```bash
cd "$(mktemp -d)" && mkdir -p store/proxy-usage
node - <<'EOF'
const now = Date.now();
const mk = (atMs, mc, extra) => JSON.stringify({ id: "e", ts: new Date(atMs).toISOString(), model: "claude-sonnet-5", inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, messageCount: mc, stream: false, ...extra });
const lines = [mk(now - 7_200_000, 1, { cacheCreationTokens: 10_000 }), mk(now - 7_140_000, 3, { cacheCreationTokens: 10_000 })];
require("node:fs").writeFileSync("store/proxy-usage/usage.jsonl", lines.join("\n") + "\n");
EOF
# free path (no license in this store): expect the upsell line
node <worktree>/apps/cli/dist-bundle/mega.mjs cache --store store
```

(Build the bundle first if absent: `pnpm --filter @megasaver/cli bundle`. The entitled path is already exercised end-to-end by the real-fs test; the smoke proves the shipped binary wiring + upsell.)

- [ ] **Step 3: Commit any stragglers, none expected**

---

### Task 8: docs — README, changeset, wiki

**Files:**
- Modify: `README.md`
- Create: `.changeset/cache-doctor.md`
- Modify: `wiki/entities/cli.md`, `wiki/log.md`

- [ ] **Step 1: README** — add after the `mega compress` section, matching its heading style:

```md
### `mega cache` — prompt-cache doctor (Pro)

Reads the metering proxy's counts-only usage log and diagnoses prompt-cache
misses: no caching at all, an unstable prefix rewriting the cache every turn,
5-minute TTL expiries, and mid-conversation model switches. Prices what the
misses burned and prints a one-line fix per finding.

```bash
mega cache             # last 7 days
mega cache --days 30
mega cache --json
```

Requires `mega proxy` metering (counts only — message content is never
stored or read).
```

- [ ] **Step 2: Changeset** — `.changeset/cache-doctor.md`:

```md
---
"@megasaver/cli": minor
---

mega cache: prompt-cache doctor. Reads the metering proxy's counts-only
usage log, detects four cache-miss signatures (no-cache, unstable-prefix,
ttl-expiry, model-switch), prices the burn against the house rate, and
prints a one-line fix per finding. Read-only; advice-only.
```

- [ ] **Step 3: Wiki** — `wiki/entities/cli.md`: append a module-9 bullet next to the module-8 one (`mega cache` — prompt-cache doctor, counts-only, 4 detectors, advice-only). `wiki/log.md`: append a `## [YYYY-MM-DD] feature | mega cache (Pro module 9) built` entry — build summary, evidence (`pnpm verify` counts), and Pending: review + PR + merge + 1.11.0.

- [ ] **Step 4: Commit**

```bash
git add README.md .changeset/cache-doctor.md wiki/entities/cli.md wiki/log.md
git commit -m "feat(cli): cache docs + changeset"
```

---

### Task 9: HIGH-risk review gate + PR

- [ ] **Step 1:** Adversarial review (code-reviewer + critic lenses, findings verified) on the full branch diff — fix confirmed findings TDD-style (red test first), commit each fix.
- [ ] **Step 2:** Push branch, open PR titled `feat(cli): mega cache — prompt-cache doctor (module 9, 1.11)`, body summarizing spec compliance + evidence.
- [ ] **Step 3:** Merge on green CI (rebase). Post-merge: 1.11.0 release ritual (changeset version → bin check → release PR → merge → tag `v1.11.0`; CI publishes — no manual npm publish, per the 1.10.0 lesson).
