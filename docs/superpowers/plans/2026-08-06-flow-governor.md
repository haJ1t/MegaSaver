# Flow Governor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Advisory session-flow nudges from the existing PreToolUse telemetry log: ONE turn-budget consolidation nudge when a session's logged tool-call count crosses 1.5× the same-task-label trailing median, and ONE loop nudge when a tool+filePath signature recurs ≥ 3× in 5 minutes — delivered through the budget-circuit-breaker's PostToolUse `additionalContext` seam, at-most-once per session per detector, independently opt-outable, all fail-open.
**Architecture:** Pure detectors + settings/state stores in `@megasaver/stats` (`flow-metrics.ts`, `flow-store.ts`), re-exported through `packages/core/src/context-gate.ts` (§3c). The saver hook does a synchronous tiny state-file read pre-stdout and a deferred post-stdout refresh (log tail ≤ 256 KB → detect → `withFileLock` + atomic state rewrite). A `mega flow` Citty group toggles detectors per workspace. BATCH-READ is NOT built here — it shipped as the cache-advice hook (`apps/cli/src/hooks/cache-advice-run.ts`); `mega flow status` only points at its existing `--no-cache-advice` opt-out.
**Tech Stack:** TypeScript strict ESM, Zod, Vitest (mkdtemp temp stores, fixed fixtures, no fs mocks), Citty CLI, `atomicWriteFile` (`packages/stats/src/atomic-write.ts`), `withFileLock` (`@megasaver/shared/node`), `redact` (`@megasaver/policy`).

## Global Constraints

- Advisory-only: hooks ALWAYS exit 0; worst failure is silence. No detector may block, deny, or rewrite a tool call.
- Data source is the shipped PreToolUse telemetry log `<cwd>/.megasaver/hooks/claude-tool-calls.jsonl` (`HOOK_LOG_RELATIVE_PATH`, `apps/cli/src/hooks/logger.ts`; lines carry `timestamp/agent/tool/category/filePath?/sessionId?`). Capture NOTHING new.
- Pre-stdout work is one synchronous read of one small JSON file; all folding/detection runs after `process.stdout.write`, synchronous, every error swallowed.
- At-most-once per session per detector via persisted `announced` flags; `pendingLines` (≤ 2, each ≤ 400 chars) are delivered on the next invocation and cleared by its refresh; a failed refresh may repeat a line once (accepted advisory noise — budget-breaker Locked #4 parity).
- Constants: `FLOW_TURN_MULTIPLE = 1.5`, `FLOW_TURN_MIN_SIBLINGS = 3`, `FLOW_TURN_MIN_LIVE_CALLS = 10`, `FLOW_LOOP_MIN_REPEATS = 3`, `FLOW_LOOP_WINDOW_MS = 300_000`, `FLOW_LOG_TAIL_BYTES = 262_144`. Fixed-fixture tests only; no timing-dependent assertions (CI-slowness lesson) — clocks and timestamps are always fixture data.
- Settings: absent → both detectors ON; corrupt → both OFF (silence is the safe failure for a nuisance-control surface); CLI `status` reports corrupt with exit 1; `enable`/`disable` rewrite from defaults (self-healing).
- §3c boundary: apps/cli imports every stats symbol via `@megasaver/core` ONLY (the `readBudget` re-export precedent in `packages/core/src/context-gate.ts`).
- `session_id` must pass `isSafeSegment` (`packages/stats/src/safe-segment.ts`) before becoming a filename; dirs 0700, files 0600, atomic tmp+rename writes; state read-modify-write guarded by `withFileLock` (lock miss → skip refresh).
- Every echoed string (task label, file path) passes through `redact` from `@megasaver/policy`; paths truncated to 120 chars.
- ASSUMPTION (ordering): budget-circuit-breaker (build order 5) lands first and provides `renderSaverStdout(decision, additionalContext?)` (its plan Task 5), `medianOf` in `packages/stats/src/token-budget-burn.ts` (Task 2), and `readTokenBudgets`/`labels{}` (Tasks 1+4). If any seam is absent at implementation time, implement it exactly per `docs/superpowers/plans/2026-08-06-budget-circuit-breaker.md` before the dependent step — never fork a variant.
- Risk MEDIUM: worktree, TDD red→green per task, `code-reviewer` before merge. Escalate to HIGH if `buildSaverDecision`, the logger's captured fields, or any PreToolUse deny path must change.

---

### Task 1: Pure flow detectors in `@megasaver/stats`

**Files:**
- `packages/stats/src/flow-metrics.ts` (new)
- `packages/stats/src/index.ts` (add exports)
- `packages/stats/test/flow-metrics.test.ts` (new)

**Interfaces:**
```ts
export const FLOW_TURN_MULTIPLE = 1.5;
export const FLOW_TURN_MIN_SIBLINGS = 3;
export const FLOW_TURN_MIN_LIVE_CALLS = 10;
export const FLOW_LOOP_MIN_REPEATS = 3;
export const FLOW_LOOP_WINDOW_MS = 300_000;
export const FLOW_LOG_TAIL_BYTES = 262_144;
export type FlowLogLine = { tsMs: number; tool: string; filePath?: string; sessionId?: string };
export function parseFlowLog(content: string): FlowLogLine[];
export type TurnBudgetFinding = { liveCalls: number; median: number; label: string };
export function evaluateTurnBudget(input: {
  lines: readonly FlowLogLine[];
  liveSessionId: string;
  labels: Readonly<Record<string, string>>;
}): TurnBudgetFinding | null;
export type LoopFinding = { tool: string; filePath: string; repeats: number };
export function detectLoop(input: {
  lines: readonly FlowLogLine[];
  liveSessionId: string;
  nowMs: number;
}): LoopFinding | null;
```

Steps:

- [ ] Write the failing test `packages/stats/test/flow-metrics.test.ts` (fixture style mirrors `packages/stats/test/token-budget.test.ts` from the breaker plan; log-line shape is the exact `HookLine` the shipped logger writes — `apps/cli/src/hooks/logger.ts`):
```ts
import { describe, expect, it } from "vitest";
import {
  FLOW_LOOP_MIN_REPEATS,
  FLOW_LOOP_WINDOW_MS,
  FLOW_TURN_MIN_LIVE_CALLS,
  FLOW_TURN_MIN_SIBLINGS,
  FLOW_TURN_MULTIPLE,
  detectLoop,
  evaluateTurnBudget,
  parseFlowLog,
} from "../src/flow-metrics.js";

const T0 = Date.parse("2026-08-06T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

function line(input: { ts: string; tool: string; filePath?: string; sessionId?: string }): string {
  return JSON.stringify({
    timestamp: input.ts,
    agent: "claude-code",
    tool: input.tool,
    category: "eligible_read",
    ...(input.filePath !== undefined ? { filePath: input.filePath } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
  });
}

function reads(sessionId: string, count: number, offsetMs = 0): string[] {
  return Array.from({ length: count }, (_, i) =>
    line({ ts: iso(offsetMs + i * 1000), tool: "Read", filePath: `src/f${i}.ts`, sessionId }),
  );
}

describe("parseFlowLog", () => {
  it("parses valid lines and skips malformed JSON, bad timestamps, missing tool", () => {
    const content = [
      line({ ts: iso(0), tool: "Read", filePath: "a.ts", sessionId: "live-1" }),
      "{truncated-first-line-of-a-tail-read",
      JSON.stringify({ timestamp: "not-a-date", agent: "claude-code", tool: "Read", category: "x" }),
      JSON.stringify({ timestamp: iso(0), agent: "claude-code", category: "x" }),
      "",
    ].join("\n");
    const parsed = parseFlowLog(content);
    expect(parsed).toEqual([{ tsMs: T0, tool: "Read", filePath: "a.ts", sessionId: "live-1" }]);
  });
});

describe("evaluateTurnBudget", () => {
  const LABELS = { "live-1": "refactor-auth", "s1": "refactor-auth", "s2": "refactor-auth", "s3": "refactor-auth" };
  const siblings = [...reads("s1", 10), ...reads("s2", 10), ...reads("s3", 12)]; // median 10

  it("fires at exactly 1.5x the sibling median, not below", () => {
    const at14 = parseFlowLog([...siblings, ...reads("live-1", 14)].join("\n"));
    expect(evaluateTurnBudget({ lines: at14, liveSessionId: "live-1", labels: LABELS })).toBeNull();
    const at15 = parseFlowLog([...siblings, ...reads("live-1", 15)].join("\n"));
    expect(evaluateTurnBudget({ lines: at15, liveSessionId: "live-1", labels: LABELS })).toEqual({
      liveCalls: 15,
      median: 10,
      label: "refactor-auth",
    });
  });

  it("stays silent under the min-live floor even past 1.5x median", () => {
    const tiny = [...reads("s1", 4), ...reads("s2", 4), ...reads("s3", 4), ...reads("live-1", 8)];
    expect(
      evaluateTurnBudget({ lines: parseFlowLog(tiny.join("\n")), liveSessionId: "live-1", labels: LABELS }),
    ).toBeNull();
    expect(FLOW_TURN_MIN_LIVE_CALLS).toBe(10);
  });

  it("needs >= 3 same-label siblings and a labeled live session", () => {
    const two = [...reads("s1", 10), ...reads("s2", 10), ...reads("live-1", 20)];
    expect(
      evaluateTurnBudget({ lines: parseFlowLog(two.join("\n")), liveSessionId: "live-1", labels: LABELS }),
    ).toBeNull();
    const all = parseFlowLog([...siblings, ...reads("live-1", 20)].join("\n"));
    expect(evaluateTurnBudget({ lines: all, liveSessionId: "live-1", labels: {} })).toBeNull();
    expect(FLOW_TURN_MIN_SIBLINGS).toBe(3);
    expect(FLOW_TURN_MULTIPLE).toBe(1.5);
  });

  it("ignores lines without a sessionId", () => {
    const anon = [...siblings, ...reads("live-1", 14), line({ ts: iso(0), tool: "Read", filePath: "x.ts" })];
    expect(
      evaluateTurnBudget({ lines: parseFlowLog(anon.join("\n")), liveSessionId: "live-1", labels: LABELS }),
    ).toBeNull();
  });
});

describe("detectLoop", () => {
  const repeat = (n: number, offsetMs = 0) =>
    Array.from({ length: n }, (_, i) =>
      line({ ts: iso(offsetMs + i * 10_000), tool: "Read", filePath: "src/hot.ts", sessionId: "live-1" }),
    );

  it("fires at 3 repeats inside the window, not at 2", () => {
    const now = T0 + 60_000;
    expect(
      detectLoop({ lines: parseFlowLog(repeat(2).join("\n")), liveSessionId: "live-1", nowMs: now }),
    ).toBeNull();
    expect(
      detectLoop({ lines: parseFlowLog(repeat(3).join("\n")), liveSessionId: "live-1", nowMs: now }),
    ).toEqual({ tool: "Read", filePath: "src/hot.ts", repeats: 3 });
    expect(FLOW_LOOP_MIN_REPEATS).toBe(3);
  });

  it("only counts repeats inside the trailing window", () => {
    const lines = parseFlowLog(repeat(3).join("\n"));
    const nowPastWindow = T0 + FLOW_LOOP_WINDOW_MS + 10_001; // first repeat aged out
    expect(detectLoop({ lines, liveSessionId: "live-1", nowMs: nowPastWindow })).toBeNull();
  });

  it("excludes other sessions and lines without filePath", () => {
    const noise = [
      ...Array.from({ length: 3 }, (_, i) =>
        line({ ts: iso(i * 1000), tool: "Read", filePath: "src/hot.ts", sessionId: "other" }),
      ),
      ...Array.from({ length: 3 }, (_, i) => line({ ts: iso(i * 1000), tool: "Bash", sessionId: "live-1" })),
    ];
    expect(
      detectLoop({ lines: parseFlowLog(noise.join("\n")), liveSessionId: "live-1", nowMs: T0 + 60_000 }),
    ).toBeNull();
  });

  it("picks the highest-repeat signature when several qualify", () => {
    const grep = Array.from({ length: 4 }, (_, i) =>
      line({ ts: iso(i * 1000), tool: "Grep", filePath: "src", sessionId: "live-1" }),
    );
    const found = detectLoop({
      lines: parseFlowLog([...repeat(3), ...grep].join("\n")),
      liveSessionId: "live-1",
      nowMs: T0 + 60_000,
    });
    expect(found).toEqual({ tool: "Grep", filePath: "src", repeats: 4 });
  });
});
```
- [ ] Run `pnpm --filter @megasaver/stats exec vitest run test/flow-metrics.test.ts` — expect failure `Cannot find module '../src/flow-metrics.js'` (RED).
- [ ] Implement `packages/stats/src/flow-metrics.ts` (pure — no I/O, no clock; `medianOf` imported from `./token-budget-burn.js`, ASSUMPTION per Global Constraints):
```ts
import { z } from "zod";
import { medianOf } from "./token-budget-burn.js";

export const FLOW_TURN_MULTIPLE = 1.5;
export const FLOW_TURN_MIN_SIBLINGS = 3;
export const FLOW_TURN_MIN_LIVE_CALLS = 10;
export const FLOW_LOOP_MIN_REPEATS = 3;
export const FLOW_LOOP_WINDOW_MS = 300_000;
export const FLOW_LOG_TAIL_BYTES = 262_144;

export type FlowLogLine = { tsMs: number; tool: string; filePath?: string; sessionId?: string };

// Tolerant per-line parse (the ingestHookLog posture, packages/stats/src/metrics.ts):
// a truncated tail head, foreign lines, and bad timestamps are skipped, never errors.
const flowLogLineSchema = z.object({
  timestamp: z.string(),
  tool: z.string().min(1),
  filePath: z.string().optional(),
  sessionId: z.string().optional(),
});

export function parseFlowLog(content: string): FlowLogLine[] {
  const out: FlowLogLine[] = [];
  for (const rawLine of content.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed === "") continue;
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = flowLogLineSchema.safeParse(record);
    if (!parsed.success) continue;
    const tsMs = Date.parse(parsed.data.timestamp);
    if (Number.isNaN(tsMs)) continue;
    out.push({
      tsMs,
      tool: parsed.data.tool,
      ...(parsed.data.filePath !== undefined ? { filePath: parsed.data.filePath } : {}),
      ...(parsed.data.sessionId !== undefined ? { sessionId: parsed.data.sessionId } : {}),
    });
  }
  return out;
}

export type TurnBudgetFinding = { liveCalls: number; median: number; label: string };

export function evaluateTurnBudget(input: {
  lines: readonly FlowLogLine[];
  liveSessionId: string;
  labels: Readonly<Record<string, string>>;
}): TurnBudgetFinding | null {
  const label = input.labels[input.liveSessionId];
  if (label === undefined) return null;
  const counts = new Map<string, number>();
  for (const l of input.lines) {
    if (l.sessionId === undefined) continue;
    counts.set(l.sessionId, (counts.get(l.sessionId) ?? 0) + 1);
  }
  const liveCalls = counts.get(input.liveSessionId) ?? 0;
  if (liveCalls < FLOW_TURN_MIN_LIVE_CALLS) return null;
  const siblingCounts: number[] = [];
  for (const [sid, count] of counts) {
    if (sid !== input.liveSessionId && input.labels[sid] === label) siblingCounts.push(count);
  }
  if (siblingCounts.length < FLOW_TURN_MIN_SIBLINGS) return null;
  const median = medianOf(siblingCounts);
  if (median === null || median <= 0) return null;
  if (liveCalls < FLOW_TURN_MULTIPLE * median) return null;
  return { liveCalls, median, label };
}

export type LoopFinding = { tool: string; filePath: string; repeats: number };

export function detectLoop(input: {
  lines: readonly FlowLogLine[];
  liveSessionId: string;
  nowMs: number;
}): LoopFinding | null {
  const floor = input.nowMs - FLOW_LOOP_WINDOW_MS;
  type Group = { tool: string; filePath: string; repeats: number; lastTsMs: number };
  const groups = new Map<string, Group>();
  for (const l of input.lines) {
    if (l.sessionId !== input.liveSessionId || l.filePath === undefined) continue;
    if (l.tsMs < floor || l.tsMs > input.nowMs) continue;
    const key = `${l.tool}\0${l.filePath}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { tool: l.tool, filePath: l.filePath, repeats: 1, lastTsMs: l.tsMs });
    } else {
      existing.repeats += 1;
      if (l.tsMs > existing.lastTsMs) existing.lastTsMs = l.tsMs;
    }
  }
  let best: Group | null = null;
  for (const g of groups.values()) {
    if (g.repeats < FLOW_LOOP_MIN_REPEATS) continue;
    if (best === null || g.repeats > best.repeats || (g.repeats === best.repeats && g.lastTsMs > best.lastTsMs)) {
      best = g;
    }
  }
  return best === null ? null : { tool: best.tool, filePath: best.filePath, repeats: best.repeats };
}
```
- [ ] Export all Task 1 symbols from `packages/stats/src/index.ts` (same named-export style as the existing per-module blocks).
- [ ] Run `pnpm --filter @megasaver/stats exec vitest run test/flow-metrics.test.ts` — expect green (GREEN).
- [ ] Commit: `feat(stats): add flow governor pure detectors`

---

### Task 2: Flow settings + per-session state store

**Files:**
- `packages/stats/src/flow-store.ts` (new)
- `packages/stats/src/index.ts` (add exports)
- `packages/stats/test/flow-store.test.ts` (new)

**Interfaces:**
```ts
export const FLOW_DETECTORS = ["turn-budget", "loop"] as const;
export type FlowDetector = (typeof FLOW_DETECTORS)[number];
export const flowSettingsSchema: z.ZodType<FlowSettings>;
export type FlowSettings = { version: 1; disabled: FlowDetector[] };
export function flowSettingsPath(root: string, workspaceKey: string): string;
export function flowSettingsStatus(root: string, workspaceKey: string): "absent" | "ok" | "corrupt";
export function readFlowSettings(root: string, workspaceKey: string): FlowSettings | null; // null = absent or corrupt
export function effectiveFlowSettings(root: string, workspaceKey: string): FlowSettings; // absent → all on; corrupt → all off
export function writeFlowSettings(root: string, workspaceKey: string, settings: FlowSettings): void;
export const flowStateSchema: z.ZodType<FlowState>;
export type FlowState = {
  version: 1;
  announced: { turnBudget: boolean; loop: boolean };
  pendingLines: string[]; // <= 2, each <= 400 chars
  updatedAt: number;
};
export function emptyFlowState(nowMs: number): FlowState;
export function flowStatePath(root: string, workspaceKey: string, sessionId: string): string;
export function readFlowState(root: string, workspaceKey: string, sessionId: string): FlowState | null;
export function writeFlowState(root: string, workspaceKey: string, sessionId: string, state: FlowState): void;
```

Steps:

- [ ] Write the failing test `packages/stats/test/flow-store.test.ts` (mkdtemp fixture, mirrors the breaker's `token-budget.test.ts` shape):
```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type FlowState,
  effectiveFlowSettings,
  emptyFlowState,
  flowSettingsPath,
  flowSettingsStatus,
  flowStatePath,
  readFlowSettings,
  readFlowState,
  writeFlowSettings,
  writeFlowState,
} from "../src/flow-store.js";

const WK = "0a1b2c3d4e5f6071";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-flow-store-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("flow settings", () => {
  it("roundtrips at stats/<wk>/flow/settings.json", () => {
    writeFlowSettings(root, WK, { version: 1, disabled: ["loop"] });
    expect(flowSettingsPath(root, WK)).toBe(join(root, "stats", WK, "flow", "settings.json"));
    expect(readFlowSettings(root, WK)).toEqual({ version: 1, disabled: ["loop"] });
    expect(flowSettingsStatus(root, WK)).toBe("ok");
  });

  it("absent → all detectors on; corrupt → all detectors off (silence is safe)", () => {
    expect(flowSettingsStatus(root, WK)).toBe("absent");
    expect(effectiveFlowSettings(root, WK)).toEqual({ version: 1, disabled: [] });
    mkdirSync(join(root, "stats", WK, "flow"), { recursive: true });
    writeFileSync(flowSettingsPath(root, WK), "{not json");
    expect(flowSettingsStatus(root, WK)).toBe("corrupt");
    expect(readFlowSettings(root, WK)).toBeNull();
    expect(effectiveFlowSettings(root, WK)).toEqual({ version: 1, disabled: ["turn-budget", "loop"] });
  });

  it("rejects unknown detectors and extra keys as corrupt", () => {
    mkdirSync(join(root, "stats", WK, "flow"), { recursive: true });
    for (const bad of [
      { version: 1, disabled: ["batch-read"] },
      { version: 2, disabled: [] },
      { version: 1, disabled: [], extra: true },
    ]) {
      writeFileSync(flowSettingsPath(root, WK), JSON.stringify(bad));
      expect(flowSettingsStatus(root, WK)).toBe("corrupt");
    }
  });
});

describe("flow state", () => {
  const STATE: FlowState = {
    version: 1,
    announced: { turnBudget: true, loop: false },
    pendingLines: ["Mega Saver flow: nudge"],
    updatedAt: 1754481600000,
  };

  it("roundtrips at stats/<wk>/flow/state-<sid>.json", () => {
    writeFlowState(root, WK, "live-1", STATE);
    expect(flowStatePath(root, WK, "live-1")).toBe(join(root, "stats", WK, "flow", "state-live-1.json"));
    expect(readFlowState(root, WK, "live-1")).toEqual(STATE);
  });

  it("returns null on absent, corrupt, or schema-invalid state", () => {
    expect(readFlowState(root, WK, "live-1")).toBeNull();
    mkdirSync(join(root, "stats", WK, "flow"), { recursive: true });
    writeFileSync(flowStatePath(root, WK, "live-1"), "{nope");
    expect(readFlowState(root, WK, "live-1")).toBeNull();
    writeFileSync(
      flowStatePath(root, WK, "live-1"),
      JSON.stringify({ ...STATE, pendingLines: ["a", "b", "c"] }),
    );
    expect(readFlowState(root, WK, "live-1")).toBeNull();
  });

  it("refuses unsafe session ids: read → null, write → throws", () => {
    expect(readFlowState(root, WK, "../evil")).toBeNull();
    expect(() => writeFlowState(root, WK, "../evil", emptyFlowState(0))).toThrow();
  });

  it("emptyFlowState carries no announcements and no pending lines", () => {
    expect(emptyFlowState(7)).toEqual({
      version: 1,
      announced: { turnBudget: false, loop: false },
      pendingLines: [],
      updatedAt: 7,
    });
  });
});
```
- [ ] Run `pnpm --filter @megasaver/stats exec vitest run test/flow-store.test.ts` — expect module-not-found failure (RED).
- [ ] Implement `packages/stats/src/flow-store.ts` (read/status mechanics mirror `readTokenBudgets`/`tokenBudgetsStatus`; atomic write via `atomicWriteFile` from `./atomic-write.js`; unsafe-write throws `new StatsError("write_failed")` from `./errors.js`):
```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { atomicWriteFile } from "./atomic-write.js";
import { StatsError } from "./errors.js";
import { isSafeSegment } from "./safe-segment.js";

export const FLOW_DETECTORS = ["turn-budget", "loop"] as const;
export type FlowDetector = (typeof FLOW_DETECTORS)[number];

export const flowSettingsSchema = z
  .object({ version: z.literal(1), disabled: z.array(z.enum(FLOW_DETECTORS)) })
  .strict();
export type FlowSettings = z.infer<typeof flowSettingsSchema>;

export const flowStateSchema = z
  .object({
    version: z.literal(1),
    announced: z.object({ turnBudget: z.boolean(), loop: z.boolean() }).strict(),
    pendingLines: z.array(z.string().max(400)).max(2),
    updatedAt: z.number(),
  })
  .strict();
export type FlowState = z.infer<typeof flowStateSchema>;

function flowDir(root: string, workspaceKey: string): string {
  return join(root, "stats", workspaceKey, "flow");
}

export function flowSettingsPath(root: string, workspaceKey: string): string {
  return join(flowDir(root, workspaceKey), "settings.json");
}

function readJsonAs<T>(path: string, schema: z.ZodType<T>): T | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function readFlowSettings(root: string, workspaceKey: string): FlowSettings | null {
  return readJsonAs(flowSettingsPath(root, workspaceKey), flowSettingsSchema);
}

export function flowSettingsStatus(root: string, workspaceKey: string): "absent" | "ok" | "corrupt" {
  if (!existsSync(flowSettingsPath(root, workspaceKey))) return "absent";
  return readFlowSettings(root, workspaceKey) === null ? "corrupt" : "ok";
}

// Hook-side semantics (spec Locked #7): absent → advisory default ON;
// corrupt → all OFF — for a nuisance-control file the safe failure is silence.
export function effectiveFlowSettings(root: string, workspaceKey: string): FlowSettings {
  const status = flowSettingsStatus(root, workspaceKey);
  if (status === "absent") return { version: 1, disabled: [] };
  if (status === "corrupt") return { version: 1, disabled: [...FLOW_DETECTORS] };
  return readFlowSettings(root, workspaceKey) ?? { version: 1, disabled: [...FLOW_DETECTORS] };
}

export function writeFlowSettings(root: string, workspaceKey: string, settings: FlowSettings): void {
  atomicWriteFile(flowSettingsPath(root, workspaceKey), `${JSON.stringify(settings)}\n`);
}

export function emptyFlowState(nowMs: number): FlowState {
  return { version: 1, announced: { turnBudget: false, loop: false }, pendingLines: [], updatedAt: nowMs };
}

export function flowStatePath(root: string, workspaceKey: string, sessionId: string): string {
  return join(flowDir(root, workspaceKey), `state-${sessionId}.json`);
}

export function readFlowState(root: string, workspaceKey: string, sessionId: string): FlowState | null {
  if (!isSafeSegment(sessionId)) return null;
  return readJsonAs(flowStatePath(root, workspaceKey, sessionId), flowStateSchema);
}

export function writeFlowState(
  root: string,
  workspaceKey: string,
  sessionId: string,
  state: FlowState,
): void {
  if (!isSafeSegment(sessionId)) throw new StatsError("write_failed");
  atomicWriteFile(flowStatePath(root, workspaceKey, sessionId), `${JSON.stringify(state)}\n`);
}
```
- [ ] Export all Task 2 symbols from `packages/stats/src/index.ts`, plus `isSafeSegment` from `./safe-segment.js` (currently internal-only — packages/stats/src/safe-segment.ts:8 is not in the index; Task 4's hook gate consumes it via the core re-export).
- [ ] Run `pnpm --filter @megasaver/stats exec vitest run test/flow-store.test.ts test/flow-metrics.test.ts` — expect green (GREEN). Verified: `StatsError` accepts code `"write_failed"` — `packages/stats/src/atomic-write.ts:25` throws the same, and `packages/stats/src/errors.ts` lists it in `statsErrorCodeSchema`.
- [ ] Commit: `feat(stats): add flow settings and state store`

---

### Task 3: Core §3c re-exports

**Files:**
- `packages/core/src/context-gate.ts` (append one export block)

**Interfaces:** re-export exactly, `from "@megasaver/stats"`: `FLOW_TURN_MULTIPLE`, `FLOW_TURN_MIN_SIBLINGS`, `FLOW_TURN_MIN_LIVE_CALLS`, `FLOW_LOOP_MIN_REPEATS`, `FLOW_LOOP_WINDOW_MS`, `FLOW_LOG_TAIL_BYTES`, `type FlowLogLine`, `parseFlowLog`, `type TurnBudgetFinding`, `evaluateTurnBudget`, `type LoopFinding`, `detectLoop`, `FLOW_DETECTORS`, `type FlowDetector`, `flowSettingsSchema`, `type FlowSettings`, `flowSettingsPath`, `flowSettingsStatus`, `readFlowSettings`, `effectiveFlowSettings`, `writeFlowSettings`, `flowStateSchema`, `type FlowState`, `emptyFlowState`, `flowStatePath`, `readFlowState`, `writeFlowState`, `isSafeSegment` (the Task 4 payload gate needs it through core — §3c).

Steps:

- [ ] Append the export block to `packages/core/src/context-gate.ts` with a one-line WHY comment mirroring the existing `1.13 persistent budget` block ("flow governor: apps/cli reads flow surfaces through core — same §3c allow-list rule").
- [ ] Run `pnpm --filter @megasaver/stats build && pnpm --filter @megasaver/core build && pnpm --filter @megasaver/core typecheck` — expect green (this task's GREEN; the consuming tests in Task 4 are the behavioral proof).
- [ ] Commit: `feat(core): re-export flow governor surface`

---

### Task 4: Hook wiring — nudge pre-stdout, refresh post-stdout

**Files:**
- `apps/cli/src/hooks/flow-run.ts` (new)
- `apps/cli/src/hooks/saver-run.ts` (edit `runSaverHookFromProcess`)
- `apps/cli/test/hooks/flow-run.test.ts` (new)

**Interfaces:**
```ts
export function maybeReadFlowNudge(payload: unknown, storeRoot: string): string | undefined; // synchronous by type
export function refreshFlowState(input: { payload: unknown; storeRoot: string; now?: () => number }): void; // never throws
export function composeAdvisory(parts: readonly (string | undefined)[]): string | undefined;
export function renderTurnNudge(finding: TurnBudgetFinding): string;
export function renderLoopNudge(finding: LoopFinding): string;
```

Steps:

- [ ] Write the failing test `apps/cli/test/hooks/flow-run.test.ts` (temp store + temp project dir; the log fixture is the same `HookLine` shape as Task 1):
```ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redact } from "@megasaver/policy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  composeAdvisory,
  maybeReadFlowNudge,
  refreshFlowState,
  renderLoopNudge,
} from "../../src/hooks/flow-run.js";

const T0 = Date.parse("2026-08-06T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

let storeRoot: string;
let projectCwd: string;
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "megasaver-flow-store-"));
  projectCwd = mkdtempSync(join(tmpdir(), "megasaver-flow-cwd-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(projectCwd, { recursive: true, force: true });
});

const payload = () => ({ session_id: "live-1", cwd: projectCwd, tool_name: "Read", tool_input: {} });

function seedLoopLog(): void {
  const dir = join(projectCwd, ".megasaver", "hooks");
  mkdirSync(dir, { recursive: true });
  const lines = Array.from({ length: 3 }, (_, i) =>
    JSON.stringify({
      timestamp: iso(i * 1000),
      agent: "claude-code",
      tool: "Read",
      category: "eligible_read",
      filePath: "src/hot.ts",
      sessionId: "live-1",
    }),
  );
  writeFileSync(join(dir, "claude-tool-calls.jsonl"), `${lines.join("\n")}\n`);
}

describe("flow hook round trip", () => {
  it("detects on refresh, delivers once on the next read, then stays silent", () => {
    seedLoopLog();
    const now = () => T0 + 60_000;
    expect(maybeReadFlowNudge(payload(), storeRoot)).toBeUndefined(); // nothing pending yet
    refreshFlowState({ payload: payload(), storeRoot, now });
    const nudge = maybeReadFlowNudge(payload(), storeRoot);
    expect(nudge).toContain("src/hot.ts");
    expect(nudge).toContain("3x");
    refreshFlowState({ payload: payload(), storeRoot, now }); // delivered → cleared, announced holds
    expect(maybeReadFlowNudge(payload(), storeRoot)).toBeUndefined();
    refreshFlowState({ payload: payload(), storeRoot, now }); // at-most-once: never re-queues
    expect(maybeReadFlowNudge(payload(), storeRoot)).toBeUndefined();
  });

  it("respects the per-detector opt-out", () => {
    seedLoopLog();
    const wk = encodeWorkspaceKey(projectCwd);
    mkdirSync(join(storeRoot, "stats", wk, "flow"), { recursive: true });
    writeFileSync(
      join(storeRoot, "stats", wk, "flow", "settings.json"),
      JSON.stringify({ version: 1, disabled: ["loop"] }),
    );
    refreshFlowState({ payload: payload(), storeRoot, now: () => T0 + 60_000 });
    expect(maybeReadFlowNudge(payload(), storeRoot)).toBeUndefined();
  });

  it("fails open on missing log, malformed payload, and unsafe session id", () => {
    expect(() => refreshFlowState({ payload: payload(), storeRoot, now: () => T0 } )).not.toThrow();
    expect(() => refreshFlowState({ payload: { nope: true }, storeRoot, now: () => T0 })).not.toThrow();
    const evil = { session_id: "../evil", cwd: projectCwd, tool_name: "Read", tool_input: {} };
    expect(() => refreshFlowState({ payload: evil, storeRoot, now: () => T0 })).not.toThrow();
    expect(maybeReadFlowNudge(evil, storeRoot)).toBeUndefined();
  });

  it("rejects an embedded-traversal session id before any filesystem use", () => {
    // A LEADING '..' is neutralized by the literal 'state-' filename prefix;
    // the dangerous shape is an EMBEDDED '/..', which normalizes out of
    // stats/<wk>/flow/ (one more '..' would leave the store root). Without the
    // contextOf gate, refreshFlowState's mkdir would create 0700 directories
    // at the escape target before readFlowState/writeFlowState ever re-check.
    const traversal = {
      session_id: "d/../../../../evil/x",
      cwd: projectCwd,
      tool_name: "Read",
      tool_input: {},
    };
    expect(() => refreshFlowState({ payload: traversal, storeRoot, now: () => T0 })).not.toThrow();
    expect(maybeReadFlowNudge(traversal, storeRoot)).toBeUndefined();
    // state-d/../../../../evil/x.json normalizes to <storeRoot>/evil/x.json —
    // the gate must leave that directory uncreated.
    expect(existsSync(join(storeRoot, "evil"))).toBe(false);
  });
});

describe("nudge rendering", () => {
  it("routes echoed paths through redact()", () => {
    const secretPath = "deploy/AKIAIOSFODNN7EXAMPLE/config.ts";
    const rendered = renderLoopNudge({ tool: "Read", filePath: secretPath, repeats: 3 });
    expect(rendered).toContain(redact(secretPath).redacted);
    expect(rendered).toContain("repeated 3x");
  });

  it("truncates echoed paths to 120 chars", () => {
    const long = `src/${"a".repeat(300)}.ts`;
    const rendered = renderLoopNudge({ tool: "Read", filePath: long, repeats: 3 });
    expect(rendered).not.toContain(long);
  });
});

describe("composeAdvisory", () => {
  it("joins present parts with newline and collapses empties to undefined", () => {
    expect(composeAdvisory(["a", undefined, "b"])).toBe("a\nb");
    expect(composeAdvisory([undefined, ""])).toBeUndefined();
    expect(composeAdvisory([])).toBeUndefined();
  });
});
```
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/hooks/flow-run.test.ts` — expect module-not-found failure (RED).
- [ ] Implement `apps/cli/src/hooks/flow-run.ts`. All flow/stats symbols import from `@megasaver/core` (§3c); `withFileLock` from `@megasaver/shared/node`; `encodeWorkspaceKey` from `@megasaver/shared`; `redact` from `@megasaver/policy`; `HOOK_LOG_RELATIVE_PATH` from `./logger.js`:
```ts
import { closeSync, fstatSync, mkdirSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import {
  FLOW_LOG_TAIL_BYTES,
  type FlowState,
  type LoopFinding,
  type TurnBudgetFinding,
  detectLoop,
  effectiveFlowSettings,
  emptyFlowState,
  evaluateTurnBudget,
  flowStatePath,
  isSafeSegment,
  parseFlowLog,
  readFlowState,
  readTokenBudgets,
  writeFlowState,
} from "@megasaver/core";
import { redact } from "@megasaver/policy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { withFileLock } from "@megasaver/shared/node";
import { z } from "zod";
import { HOOK_LOG_RELATIVE_PATH } from "./logger.js";

const FLOW_NUDGE_PATH_MAX = 120;
const FLOW_LOCK_DEADLINE_MS = 50;
const FLOW_LOCK_STALE_MS = 10_000;

const payloadSchema = z.object({ session_id: z.string().min(1), cwd: z.string().min(1) });

type FlowContext = { sessionId: string; cwd: string; workspaceKey: string };

function contextOf(payload: unknown): FlowContext | undefined {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return undefined;
  // Path-safety gate BEFORE any filesystem use (spec Security & privacy;
  // Global Constraints): flowStatePath interpolates the id into a filename,
  // and refreshFlowState runs mkdir + withFileLock on that path — an id with
  // an embedded '/..' would otherwise normalize out of stats/<wk>/flow/.
  // readFlowState/writeFlowState re-check, but they run after the mkdir+lock,
  // so the gate must sit here, ahead of every caller's first fs touch.
  if (!isSafeSegment(parsed.data.session_id)) return undefined;
  return {
    sessionId: parsed.data.session_id,
    cwd: parsed.data.cwd,
    workspaceKey: encodeWorkspaceKey(parsed.data.cwd),
  };
}

// Synchronous by type (budget-breaker Locked #3 discipline): ONE small state
// read pre-stdout; a missing/corrupt state or unsafe id is silence, never a block.
export function maybeReadFlowNudge(payload: unknown, storeRoot: string): string | undefined {
  try {
    const ctx = contextOf(payload);
    if (ctx === undefined) return undefined;
    const state = readFlowState(storeRoot, ctx.workspaceKey, ctx.sessionId);
    if (state === null || state.pendingLines.length === 0) return undefined;
    return state.pendingLines.join("\n");
  } catch {
    return undefined;
  }
}

export function composeAdvisory(parts: readonly (string | undefined)[]): string | undefined {
  const present = parts.filter((p): p is string => p !== undefined && p !== "");
  return present.length === 0 ? undefined : present.join("\n");
}

export function renderTurnNudge(finding: TurnBudgetFinding): string {
  const label = redact(finding.label).redacted;
  return `Mega Saver flow: ${finding.liveCalls} logged tool calls vs a median of ${finding.median} for "${label}" sessions. If you have open questions, batch them into one message instead of more round-trips.`;
}

export function renderLoopNudge(finding: LoopFinding): string {
  const path = redact(finding.filePath).redacted;
  const shown = path.length > FLOW_NUDGE_PATH_MAX ? `…${path.slice(-FLOW_NUDGE_PATH_MAX)}` : path;
  return `Mega Saver flow: ${finding.tool} on ${shown} repeated ${finding.repeats}x in the last 5 minutes. If this is a retry loop, stop and diagnose the root cause before retrying.`;
}

// Tail-bounded read: never load an unbounded telemetry log into the hook.
// A mid-line start is fine — parseFlowLog skips the truncated head line.
function readLogTail(logPath: string): string {
  try {
    const fd = openSync(logPath, "r");
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(size, FLOW_LOG_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      return buffer.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
}

// Deferred post-stdout refresh (never throws): clear delivered lines, evaluate
// enabled+unannounced detectors over the log tail, persist under the lock.
export function refreshFlowState(input: {
  payload: unknown;
  storeRoot: string;
  now?: () => number;
}): void {
  try {
    const ctx = contextOf(input.payload);
    if (ctx === undefined) return;
    const now = input.now ?? Date.now;
    const settings = effectiveFlowSettings(input.storeRoot, ctx.workspaceKey);
    const statePath = flowStatePath(input.storeRoot, ctx.workspaceKey, ctx.sessionId);
    mkdirSync(join(statePath, ".."), { recursive: true, mode: 0o700 });
    withFileLock(
      `${statePath}.lock`,
      { deadlineMs: FLOW_LOCK_DEADLINE_MS, staleMs: FLOW_LOCK_STALE_MS },
      () => {
        const prior = readFlowState(input.storeRoot, ctx.workspaceKey, ctx.sessionId);
        const state: FlowState = prior ?? emptyFlowState(now());
        const hadPending = state.pendingLines.length > 0;
        state.pendingLines = []; // delivered by this invocation's pre-stdout read
        const wantTurn = !state.announced.turnBudget && !settings.disabled.includes("turn-budget");
        const wantLoop = !state.announced.loop && !settings.disabled.includes("loop");
        if (wantTurn || wantLoop) {
          const lines = parseFlowLog(readLogTail(join(ctx.cwd, HOOK_LOG_RELATIVE_PATH)));
          if (wantTurn) {
            const labels = readTokenBudgets(input.storeRoot, ctx.workspaceKey)?.labels ?? {};
            const finding = evaluateTurnBudget({ lines, liveSessionId: ctx.sessionId, labels });
            if (finding !== null) {
              state.announced.turnBudget = true;
              state.pendingLines.push(renderTurnNudge(finding));
            }
          }
          if (wantLoop) {
            const finding = detectLoop({ lines, liveSessionId: ctx.sessionId, nowMs: now() });
            if (finding !== null) {
              state.announced.loop = true;
              state.pendingLines.push(renderLoopNudge(finding));
            }
          }
        }
        // Steady state (both announced or disabled, nothing delivered): skip the write.
        if (prior !== null && !hadPending && state.pendingLines.length === 0) return;
        state.updatedAt = now();
        writeFlowState(input.storeRoot, ctx.workspaceKey, ctx.sessionId, state);
      },
    );
  } catch {
    // §13.4 fail-open — the tool call is never affected by flow bookkeeping.
  }
}
```
  ASSUMPTION: `readTokenBudgets` is re-exported from `@megasaver/core` by the budget-breaker plan Task 4; if absent, land that task first (Global Constraints).
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/hooks/flow-run.test.ts` — expect green (GREEN).
- [ ] Wire `runSaverHookFromProcess` in `apps/cli/src/hooks/saver-run.ts`: compute `const flowNudge = maybeReadFlowNudge(payload, storeRoot);` before the stdout write, pass `composeAdvisory([budgetWarning, flowNudge])` as `renderSaverStdout`'s second argument (ASSUMPTION: the `additionalContext` parameter exists via breaker plan Task 5 — otherwise land that task first), and add `refreshFlowState({ payload, storeRoot });` after the existing `maybeRunOverlayGc` line (post-stdout, beside the breaker's `refreshBudgetState`). If the breaker wiring is not yet present, pass `composeAdvisory([flowNudge])` and leave a one-line WHY comment referencing the shared seam.
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/hooks/saver-run.test.ts test/hooks/flow-run.test.ts` — expect green: the existing `renderSaverStdout`/roundtrip suites must be byte-identical when no flow state exists (the fill-gap is inert without a file — regression evidence).
- [ ] Commit: `feat(cli): deliver flow nudges via saver hook`

---

### Task 5: `mega flow` CLI — status / enable / disable

**Files:**
- `apps/cli/src/commands/flow.ts` (new)
- `apps/cli/src/main.ts` (register `flow: flowCommand`)
- `apps/cli/test/flow.test.ts` (new)

**Interfaces:**
```ts
export type RunFlowInput = {
  storeFlag: string | undefined;
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};
export async function runFlowStatus(input: RunFlowInput): Promise<0 | 1>;
export async function runFlowToggle(input: RunFlowInput & { detector: string; enable: boolean }): Promise<0 | 1>;
export const flowCommand: /* Citty */ CommandDef; // subCommands: status | enable <detector> | disable <detector>
```

Steps:

- [ ] Write the failing test `apps/cli/test/flow.test.ts` exercising the inner run functions directly (the `wiki/workflows/cli-test-pattern.md` "inner function" mode — injected `stdout`/`stderr`, mkdtemp store passed via `storeFlag`):
```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runFlowStatus, runFlowToggle } from "../src/commands/flow.js";

let root: string;
let cwd: string;
let out: string[];
let err: string[];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-flow-cli-"));
  cwd = mkdtempSync(join(tmpdir(), "megasaver-flow-proj-"));
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const io = () => ({
  storeFlag: root,
  cwd,
  stdout: (line: string) => out.push(line),
  stderr: (line: string) => err.push(line),
});

describe("mega flow", () => {
  it("status shows both detectors on by default plus the batch-read pointer", async () => {
    expect(await runFlowStatus(io())).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("turn-budget: on");
    expect(text).toContain("loop: on");
    expect(text).toContain("--no-cache-advice");
  });

  it("disable then enable roundtrips one detector without touching the other", async () => {
    expect(await runFlowToggle({ ...io(), detector: "loop", enable: false })).toBe(0);
    out = [];
    await runFlowStatus(io());
    expect(out.join("\n")).toContain("loop: off");
    expect(out.join("\n")).toContain("turn-budget: on");
    expect(await runFlowToggle({ ...io(), detector: "loop", enable: true })).toBe(0);
    out = [];
    await runFlowStatus(io());
    expect(out.join("\n")).toContain("loop: on");
  });

  it("rejects unknown detectors with exit 1", async () => {
    expect(await runFlowToggle({ ...io(), detector: "batch-read", enable: false })).toBe(1);
    expect(err.join("\n")).toContain("turn-budget");
  });

  it("status reports a corrupt settings file with exit 1 and the path; toggle self-heals it", async () => {
    const wk = encodeWorkspaceKey(cwd);
    mkdirSync(join(root, "stats", wk, "flow"), { recursive: true });
    writeFileSync(join(root, "stats", wk, "flow", "settings.json"), "{nope");
    expect(await runFlowStatus(io())).toBe(1);
    expect(err.join("\n")).toContain("settings.json");
    expect(await runFlowToggle({ ...io(), detector: "loop", enable: false })).toBe(0);
    out = [];
    expect(await runFlowStatus(io())).toBe(0);
    expect(out.join("\n")).toContain("loop: off");
  });
});
```
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/flow.test.ts` — expect module-not-found failure (RED).
- [ ] Implement `apps/cli/src/commands/flow.ts` per the cli-test-pattern handler shape: inner functions resolve the store via `resolveStorePath(readStoreEnv(storeFlag))` (`../store.js`, the `saver-run.ts` precedent) and `workspaceKey = encodeWorkspaceKey(cwd)`; all store symbols via `@megasaver/core`:

```ts
import {
  FLOW_DETECTORS,
  type FlowDetector,
  type FlowSettings,
  effectiveFlowSettings,
  flowSettingsPath,
  flowSettingsStatus,
  readFlowSettings,
  writeFlowSettings,
} from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../errors.js";
import { readStoreEnv, resolveStorePath } from "../store.js";

export type RunFlowInput = {
  storeFlag: string | undefined;
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

// BATCH-READ is owned by the shipped cache-advice hook — status only points.
const BATCH_READ_POINTER =
  "batch-read: owned by the batch-read advice hook (opt out: mega hooks install --no-cache-advice)";

function resolveRoot(input: RunFlowInput): { root: string } | { error: 1 } {
  try {
    return { root: resolveStorePath(readStoreEnv(input.storeFlag)) };
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return { error: 1 };
  }
}

export async function runFlowStatus(input: RunFlowInput): Promise<0 | 1> {
  const resolved = resolveRoot(input);
  if ("error" in resolved) return 1;
  const wk = encodeWorkspaceKey(input.cwd);
  if (flowSettingsStatus(resolved.root, wk) === "corrupt") {
    input.stderr(
      `error: corrupt flow settings at ${flowSettingsPath(resolved.root, wk)} — run mega flow enable <detector> to rewrite it`,
    );
    return 1;
  }
  const settings = effectiveFlowSettings(resolved.root, wk);
  for (const detector of FLOW_DETECTORS) {
    input.stdout(`${detector}: ${settings.disabled.includes(detector) ? "off" : "on"}`);
  }
  input.stdout(BATCH_READ_POINTER);
  return 0;
}

export async function runFlowToggle(
  input: RunFlowInput & { detector: string; enable: boolean },
): Promise<0 | 1> {
  if (!(FLOW_DETECTORS as readonly string[]).includes(input.detector)) {
    input.stderr(
      `error: unknown detector "${input.detector}" (valid: ${FLOW_DETECTORS.join(", ")})`,
    );
    return 1;
  }
  const detector = input.detector as FlowDetector;
  const resolved = resolveRoot(input);
  if ("error" in resolved) return 1;
  const wk = encodeWorkspaceKey(input.cwd);
  // Corrupt or absent both fall back to defaults: the rewrite self-heals.
  const prior: FlowSettings = readFlowSettings(resolved.root, wk) ?? { version: 1, disabled: [] };
  const disabled = prior.disabled.filter((d) => d !== detector);
  if (!input.enable) disabled.push(detector);
  writeFlowSettings(resolved.root, wk, { version: 1, disabled });
  input.stdout(`${detector}: ${input.enable ? "on" : "off"}`);
  return 0;
}

const storeArg = {
  store: { type: "string", description: "Override store directory." },
} as const;

function flowIo(store: unknown): RunFlowInput {
  return {
    storeFlag: typeof store === "string" ? store : undefined,
    cwd: process.cwd(),
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  };
}

const flowStatusCommand = defineCommand({
  meta: { name: "status", description: "Show flow detector toggles for this workspace." },
  args: { ...storeArg },
  async run({ args }) {
    const code = await runFlowStatus(flowIo(args.store));
    if (code !== 0) process.exitCode = code;
  },
});

const toggleArgs = {
  detector: {
    type: "positional",
    required: true,
    description: "Detector (turn-budget | loop).",
  },
  ...storeArg,
} as const;

const flowEnableCommand = defineCommand({
  meta: { name: "enable", description: "Enable a flow detector for this workspace." },
  args: toggleArgs,
  async run({ args }) {
    const code = await runFlowToggle({
      ...flowIo(args.store),
      detector: typeof args.detector === "string" ? args.detector : "",
      enable: true,
    });
    if (code !== 0) process.exitCode = code;
  },
});

const flowDisableCommand = defineCommand({
  meta: { name: "disable", description: "Disable a flow detector for this workspace." },
  args: toggleArgs,
  async run({ args }) {
    const code = await runFlowToggle({
      ...flowIo(args.store),
      detector: typeof args.detector === "string" ? args.detector : "",
      enable: false,
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const flowCommand = defineCommand({
  meta: {
    name: "flow",
    description: "Advisory session-flow nudges (turn budget, loop detection).",
  },
  subCommands: {
    status: flowStatusCommand,
    enable: flowEnableCommand,
    disable: flowDisableCommand,
  },
});
```
- [ ] Register in `apps/cli/src/main.ts`: import `flowCommand`, add `flow: flowCommand` to `subCommands`.
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/flow.test.ts` — expect green (GREEN).
- [ ] Commit: `feat(cli): add mega flow detector toggles`

---

### Task 6: Changeset, wiki, verify, smoke evidence

**Files:**
- `.changeset/flow-governor.md` (new)
- `wiki/entities/cli.md`, `wiki/entities/stats.md`, `wiki/log.md` (update)

Steps:

- [ ] Create `.changeset/flow-governor.md`: minor bumps for `@megasaver/stats`, `@megasaver/core`, `@megasaver/cli` — "Flow Governor: advisory turn-budget and loop nudges over PreToolUse telemetry, delivered via the saver hook additionalContext channel; `mega flow` per-detector toggles."
- [ ] Update `wiki/entities/stats.md` (flow-metrics + flow-store surfaces) and `wiki/entities/cli.md` (`mega flow`, hook wiring); append a timestamped `wiki/log.md` entry.
- [ ] Run `pnpm verify` at the branch tip — lint + typecheck + full vitest green (DoD #4). Do NOT claim done before this passes.
- [ ] Smoke evidence (DoD #5), captured terminal session: seed `<proj>/.megasaver/hooks/claude-tool-calls.jsonl` with a 3-repeat loop fixture and a labeled-sibling turn fixture plus `stats/<wk>/budget/budgets.json` labels; pipe a PostToolUse payload into the saver hook entry twice; show (1) first run emits no `additionalContext`, (2) second run's envelope carries both nudges, (3) third run is silent again; then `mega flow disable loop` + re-seed a fresh session id and show the loop nudge is suppressed while turn-budget still fires.
- [ ] Request review per §9.6: `code-reviewer` in a fresh context (author ≠ reviewer). MEDIUM risk — no critic pass required unless the reviewer upgrades.
- [ ] Commit: `chore(flow): changeset and wiki updates`

---

## Self-review notes

- Verified against source: `HOOK_LOG_RELATIVE_PATH` + `HookLine` fields (`apps/cli/src/hooks/logger.ts`), tolerant-parse precedent `ingestHookLog` (`packages/stats/src/metrics.ts`), `withFileLock(lockPath, {deadlineMs, staleMs}, fn)` (`packages/shared/src/file-lock.ts`, exported via `@megasaver/shared/node`), `redact(text).redacted` (`packages/policy/src/redact.ts`; usage precedent `captureIntent` in `apps/cli/src/hooks/intent-run.ts`), `atomicWriteFile`/`StatsError("write_failed")` (`packages/stats/src/atomic-write.ts`), `isSafeSegment` (`packages/stats/src/safe-segment.ts`), saver payload carries `session_id`+`cwd` (`apps/cli/src/hooks/saver.ts`), core §3c re-export precedent (`packages/core/src/context-gate.ts`), `subCommands` registration (`apps/cli/src/main.ts`), no existing `flow` command collision, batch-read adviser shipped with `--no-cache-advice` (`apps/cli/src/commands/hooks/install.ts`).
- ASSUMPTION markers (all on budget-circuit-breaker, build order 5 → 6): `medianOf` from `./token-budget-burn.js` (Task 1), `readTokenBudgets` via `@megasaver/core` (Task 4), `renderSaverStdout(decision, additionalContext?)` (Task 4). Each has an explicit land-the-breaker-task-first fallback; none forks a variant.
- The `hadPending`/skip-write branch keeps the steady-state hook cost at one small read; the delivered-then-cleared cycle reproduces the breaker's accepted once-repeat advisory noise, not a new invariant.
