# Budget Circuit Breaker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-session and per-task token budgets with 80%/100% warnings and a 3x-median variance alarm, surfaced through the existing PostToolUse saver hook (warn-only) and a `mega budget` CLI.
**Architecture:** New store + pure-math modules in `@megasaver/stats` (budgets file, per-session check state, burn fold/evaluator), re-exported through `packages/core/src/context-gate.ts` (§3c). The hook does a synchronous tiny state-file read before stdout and a deferred sync refresh after stdout (the `maybeRunOverlayGc` slot); `renderSaverStdout` gains an `additionalContext` parameter.
**Tech Stack:** TypeScript strict ESM, Zod schemas, Vitest (mkdtemp temp stores, no mocks for fs), Citty CLI, existing `atomicWriteFile` (`packages/stats/src/atomic-write.ts`).

## Global Constraints

- v1 is WARN-ONLY: the hook never blocks, never denies, always exits 0; worst failure = no warning.
- Zero added awaited I/O before the hook's stdout write; the pre-stdout check is one synchronous read of one small JSON file; the refresh runs after `process.stdout.write`, is synchronous, and swallows every error.
- Receipts only: burn = Σ measured `returnedTokens` over overlay events; events without the field count as `unmeasuredEvents` (coverage), NEVER estimated from bytes.
- Thresholds: warn at 80% (`BUDGET_WARN_RATIO = 0.8`) and 100%; variance alarm at `burn >= 3 × median` (`BUDGET_VARIANCE_MULTIPLE = 3`) with `>= 3` samples (`BUDGET_VARIANCE_MIN_SAMPLES = 3`); each announced once per session (state flags).
- Budget precedence: `sessions[id]` > `tasks[labels[id]]` > `sessionDefault`.
- apps/cli imports every stats symbol via `@megasaver/core` only (§3c pin; precedent `readBudget` in `packages/core/src/context-gate.ts`).
- `liveSessionId` must pass `isSafeSegment` (`packages/stats/src/safe-segment.ts`) before becoming a filename; dirs 0700, files 0600, atomic tmp+rename writes.
- Corrupt `budgets.json`: CLI exits 1 with path + clear hint; hook treats corrupt as absent (fail-open).
- Never call the self-healing overlay summary readers from the hook (`readOverlaySummary` writes on read — `wiki/entities/stats.md` C1 lesson); fold `readOverlayEvents` instead.
- No timing-tight tests; percentile math and threshold edges use fixed fixtures.
- Risk HIGH: implement in a worktree, `architect` pass before code, `code-reviewer` AND `critic` before merge.

---

### Task 1: Token budget store module in `@megasaver/stats`

**Files:**
- `packages/stats/src/token-budget.ts` (new)
- `packages/stats/src/index.ts` (add exports)
- `packages/stats/test/token-budget.test.ts` (new)
- `packages/stats/test/no-eager-typescript.test.ts` (new — mimics `packages/output-filter/test/no-eager-typescript.test.ts`)

**Interfaces:**
```ts
export const TOKEN_BUDGET_LABEL_MAX = 64;
export const storedTokenBudgetsSchema: z.ZodType<StoredTokenBudgets>;
export type StoredTokenBudgets = {
  version: 1;
  sessionDefault?: number;
  sessions: Record<string, number>;
  tasks: Record<string, number>;
  labels: Record<string, string>;
};
export function tokenBudgetsPath(root: string, workspaceKey: string): string;
export function readTokenBudgets(root: string, workspaceKey: string): StoredTokenBudgets | null;
export function tokenBudgetsStatus(root: string, workspaceKey: string): "absent" | "ok" | "corrupt";
export function writeTokenBudgets(root: string, workspaceKey: string, budgets: StoredTokenBudgets): void;
export function clearTokenBudgets(root: string, workspaceKey: string): void; // rm -rf stats/<wk>/budget/
export type BudgetScope = "session" | "task" | "workspace-default";
export type EffectiveBudget = { limitTokens: number; scope: BudgetScope; taskLabel?: string };
export function effectiveSessionBudget(
  budgets: StoredTokenBudgets,
  liveSessionId: string,
): EffectiveBudget | null;
```

Steps:

- [ ] Write the failing test `packages/stats/test/token-budget.test.ts` (fixture shape mirrors `packages/stats/test/budget.test.ts`):
```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StoredTokenBudgets,
  clearTokenBudgets,
  effectiveSessionBudget,
  readTokenBudgets,
  tokenBudgetsPath,
  tokenBudgetsStatus,
  writeTokenBudgets,
} from "../src/token-budget.js";

const WK = "0a1b2c3d4e5f6071";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-token-budget-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const BUDGETS: StoredTokenBudgets = {
  version: 1,
  sessionDefault: 500_000,
  sessions: { "live-1": 100_000 },
  tasks: { "refactor-auth": 200_000 },
  labels: { "live-1": "refactor-auth", "live-2": "refactor-auth" },
};

describe("token budget store", () => {
  it("roundtrips and lives at stats/<wk>/budget/budgets.json", () => {
    writeTokenBudgets(root, WK, BUDGETS);
    expect(tokenBudgetsPath(root, WK)).toBe(join(root, "stats", WK, "budget", "budgets.json"));
    expect(readTokenBudgets(root, WK)).toEqual(BUDGETS);
    expect(tokenBudgetsStatus(root, WK)).toBe("ok");
  });

  it("absent → null/absent; corrupt JSON → null/corrupt", () => {
    expect(readTokenBudgets(root, WK)).toBeNull();
    expect(tokenBudgetsStatus(root, WK)).toBe("absent");
    mkdirSync(join(root, "stats", WK, "budget"), { recursive: true });
    writeFileSync(tokenBudgetsPath(root, WK), "{not json");
    expect(readTokenBudgets(root, WK)).toBeNull();
    expect(tokenBudgetsStatus(root, WK)).toBe("corrupt");
  });

  it("rejects schema-invalid shapes as corrupt (bad version, negative amount, oversize label, extra key)", () => {
    mkdirSync(join(root, "stats", WK, "budget"), { recursive: true });
    for (const bad of [
      { ...BUDGETS, version: 2 },
      { ...BUDGETS, sessions: { "live-1": -5 } },
      { ...BUDGETS, tasks: { ["x".repeat(65)]: 1000 } },
      { ...BUDGETS, extra: true },
    ]) {
      writeFileSync(tokenBudgetsPath(root, WK), JSON.stringify(bad));
      expect(readTokenBudgets(root, WK)).toBeNull();
      expect(tokenBudgetsStatus(root, WK)).toBe("corrupt");
    }
  });

  it("clearTokenBudgets removes the whole budget dir including state files", () => {
    writeTokenBudgets(root, WK, BUDGETS);
    writeFileSync(join(root, "stats", WK, "budget", "state-live-1.json"), "{}");
    clearTokenBudgets(root, WK);
    expect(tokenBudgetsStatus(root, WK)).toBe("absent");
    expect(readFileSync).toBeDefined();
  });
});

describe("effectiveSessionBudget precedence", () => {
  it("explicit session beats task label beats workspace default", () => {
    expect(effectiveSessionBudget(BUDGETS, "live-1")).toEqual({
      limitTokens: 100_000,
      scope: "session",
    });
    expect(effectiveSessionBudget(BUDGETS, "live-2")).toEqual({
      limitTokens: 200_000,
      scope: "task",
      taskLabel: "refactor-auth",
    });
    expect(effectiveSessionBudget(BUDGETS, "live-3")).toEqual({
      limitTokens: 500_000,
      scope: "workspace-default",
    });
  });

  it("returns null when nothing applies", () => {
    const none: StoredTokenBudgets = { version: 1, sessions: {}, tasks: {}, labels: {} };
    expect(effectiveSessionBudget(none, "live-9")).toBeNull();
  });
});
```
- [ ] Run `pnpm --filter @megasaver/stats exec vitest run test/token-budget.test.ts` — expect failure `Cannot find module '../src/token-budget.js'`.
- [ ] Implement `packages/stats/src/token-budget.ts` (read/status/write/clear mechanics mirror `packages/stats/src/budget.ts`; atomic write via existing `atomicWriteFile` from `./atomic-write.js`):
```ts
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { atomicWriteFile } from "./atomic-write.js";

export const TOKEN_BUDGET_LABEL_MAX = 64;

const limitField = z.number().int().positive();
const labelField = z.string().min(1).max(TOKEN_BUDGET_LABEL_MAX);

export const storedTokenBudgetsSchema = z
  .object({
    version: z.literal(1),
    sessionDefault: limitField.optional(),
    sessions: z.record(z.string().min(1), limitField),
    tasks: z.record(labelField, limitField),
    labels: z.record(z.string().min(1), labelField),
  })
  .strict();

export type StoredTokenBudgets = z.infer<typeof storedTokenBudgetsSchema>;

export function tokenBudgetsPath(root: string, workspaceKey: string): string {
  return join(root, "stats", workspaceKey, "budget", "budgets.json");
}

export function readTokenBudgets(root: string, workspaceKey: string): StoredTokenBudgets | null {
  let raw: string;
  try {
    raw = readFileSync(tokenBudgetsPath(root, workspaceKey), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = storedTokenBudgetsSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function tokenBudgetsStatus(
  root: string,
  workspaceKey: string,
): "absent" | "ok" | "corrupt" {
  if (!existsSync(tokenBudgetsPath(root, workspaceKey))) return "absent";
  return readTokenBudgets(root, workspaceKey) === null ? "corrupt" : "ok";
}

export function writeTokenBudgets(
  root: string,
  workspaceKey: string,
  budgets: StoredTokenBudgets,
): void {
  atomicWriteFile(tokenBudgetsPath(root, workspaceKey), `${JSON.stringify(budgets)}\n`);
}

export function clearTokenBudgets(root: string, workspaceKey: string): void {
  rmSync(dirname(tokenBudgetsPath(root, workspaceKey)), { recursive: true, force: true });
}

export type BudgetScope = "session" | "task" | "workspace-default";
export type EffectiveBudget = { limitTokens: number; scope: BudgetScope; taskLabel?: string };

export function effectiveSessionBudget(
  budgets: StoredTokenBudgets,
  liveSessionId: string,
): EffectiveBudget | null {
  const explicit = budgets.sessions[liveSessionId];
  if (explicit !== undefined) return { limitTokens: explicit, scope: "session" };
  const label = budgets.labels[liveSessionId];
  if (label !== undefined) {
    const taskLimit = budgets.tasks[label];
    if (taskLimit !== undefined) {
      return { limitTokens: taskLimit, scope: "task", taskLabel: label };
    }
  }
  if (budgets.sessionDefault !== undefined) {
    return { limitTokens: budgets.sessionDefault, scope: "workspace-default" };
  }
  return null;
}
```
- [ ] Export from `packages/stats/src/index.ts` (same named-export style as the existing `./budget.js` line block): `TOKEN_BUDGET_LABEL_MAX`, `storedTokenBudgetsSchema`, `StoredTokenBudgets`, `tokenBudgetsPath`, `readTokenBudgets`, `tokenBudgetsStatus`, `writeTokenBudgets`, `clearTokenBudgets`, `BudgetScope`, `EffectiveBudget`, `effectiveSessionBudget`.
- [ ] Add `packages/stats/test/no-eager-typescript.test.ts` — copy `packages/output-filter/test/no-eager-typescript.test.ts` verbatim, change the describe/it wording to `@megasaver/stats` (the `entryUrl` computation `new URL("../dist/index.js", import.meta.url).href` is identical). Run `pnpm --filter @megasaver/stats build` first so `dist/index.js` exists (precedent requires built dist).
- [ ] Run `pnpm --filter @megasaver/stats exec vitest run test/token-budget.test.ts test/no-eager-typescript.test.ts` — expect all green.
- [ ] Commit: `feat(stats): token budget store per workspace`

---

### Task 2: Burn fold, median, and threshold evaluator (pure math)

**Files:**
- `packages/stats/src/token-budget-burn.ts` (new)
- `packages/stats/src/index.ts` (add exports)
- `packages/stats/test/token-budget-burn.test.ts` (new)

**Interfaces:**
```ts
export const BUDGET_WARN_RATIO = 0.8;
export const BUDGET_VARIANCE_MULTIPLE = 3;
export const BUDGET_VARIANCE_MIN_SAMPLES = 3;
export type MeasuredBurn = { burnTokens: number; measuredEvents: number; unmeasuredEvents: number };
export function foldMeasuredBurn(events: readonly OverlayTokenSaverEvent[]): MeasuredBurn;
export function medianOf(values: readonly number[]): number | null; // null on empty
export type BudgetAnnouncements = { warn80: boolean; warn100: boolean; variance: boolean };
export type EvaluateBudgetInput = {
  burn: MeasuredBurn;
  limit: EffectiveBudget | null;
  historicalBurns: readonly number[]; // same-label sibling sessions with >= 1 measured event (may include in-flight partial burns — spec Locked #5 advisory noise); empty when unlabeled
  announced: BudgetAnnouncements;
};
export type BudgetEvaluation = { lines: readonly string[]; announced: BudgetAnnouncements };
export function evaluateBudget(input: EvaluateBudgetInput): BudgetEvaluation;
```

Steps:

- [ ] Write the failing test `packages/stats/test/token-budget-burn.test.ts` — fixed fixtures only, no clocks. Event fixtures reuse the real `overlayTokenSaverEventSchema` shape (`packages/stats/src/event.ts`); build a helper:
```ts
import { describe, expect, it } from "vitest";
import type { OverlayTokenSaverEvent } from "../src/event.js";
import {
  BUDGET_VARIANCE_MIN_SAMPLES,
  BUDGET_VARIANCE_MULTIPLE,
  BUDGET_WARN_RATIO,
  type BudgetAnnouncements,
  evaluateBudget,
  foldMeasuredBurn,
  medianOf,
} from "../src/token-budget-burn.js";

function ev(overrides: Partial<OverlayTokenSaverEvent>): OverlayTokenSaverEvent {
  return {
    id: "ove-1",
    liveSessionId: "live-1",
    workspaceKey: "0a1b2c3d4e5f6071",
    createdAt: "2026-08-06T10:00:00.000+00:00",
    sourceKind: "command",
    label: "vitest run",
    rawBytes: 100_000,
    returnedBytes: 2_000,
    bytesSaved: 98_000,
    savingRatio: 0.98,
    summary: "s",
    ...overrides,
  };
}

const NONE: BudgetAnnouncements = { warn80: false, warn100: false, variance: false };

describe("foldMeasuredBurn", () => {
  it("sums returnedTokens over measured rows and counts unmeasured rows", () => {
    const burn = foldMeasuredBurn([
      ev({ id: "a", returnedTokens: 500 }),
      ev({ id: "b", returnedTokens: 700, kind: "expansion" }),
      ev({ id: "c" }), // no returnedTokens → UNMEASURED, never estimated
    ]);
    expect(burn).toEqual({ burnTokens: 1200, measuredEvents: 2, unmeasuredEvents: 1 });
  });
});

describe("medianOf", () => {
  it("odd length → exact middle; even length → mean of two middles; empty → null", () => {
    expect(medianOf([9, 1, 5])).toBe(5);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    expect(medianOf([])).toBeNull();
  });
});

describe("evaluateBudget thresholds", () => {
  const limit = { limitTokens: 1000, scope: "task" as const, taskLabel: "refactor-auth" };
  it("below 80% → no lines, announcements unchanged", () => {
    const r = evaluateBudget({
      burn: { burnTokens: 799, measuredEvents: 3, unmeasuredEvents: 0 },
      limit, historicalBurns: [], announced: NONE,
    });
    expect(r.lines).toEqual([]);
    expect(r.announced).toEqual(NONE);
  });
  it("at exactly 80% → one warn line, warn80 flips, not warn100", () => {
    const r = evaluateBudget({
      burn: { burnTokens: 800, measuredEvents: 3, unmeasuredEvents: 1 },
      limit, historicalBurns: [], announced: NONE,
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toContain("80%");
    expect(r.lines[0]).toContain("refactor-auth");
    expect(r.announced).toEqual({ warn80: true, warn100: false, variance: false });
  });
  it("at 100% with warn80 already announced → only the exceeded line", () => {
    const r = evaluateBudget({
      burn: { burnTokens: 1000, measuredEvents: 4, unmeasuredEvents: 0 },
      limit, historicalBurns: [],
      announced: { warn80: true, warn100: false, variance: false },
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toContain("EXCEEDED");
    expect(r.lines[0]).toContain("warn-only");
    expect(r.announced.warn100).toBe(true);
  });
  it("already fully announced → silent forever", () => {
    const r = evaluateBudget({
      burn: { burnTokens: 5000, measuredEvents: 9, unmeasuredEvents: 0 },
      limit, historicalBurns: [],
      announced: { warn80: true, warn100: true, variance: false },
    });
    expect(r.lines).toEqual([]);
  });
  it("no limit → threshold lines never fire", () => {
    const r = evaluateBudget({
      burn: { burnTokens: 5000, measuredEvents: 9, unmeasuredEvents: 0 },
      limit: null, historicalBurns: [], announced: NONE,
    });
    expect(r.lines).toEqual([]);
  });
});

describe("evaluateBudget variance alarm", () => {
  const limit = { limitTokens: 1_000_000, scope: "task" as const, taskLabel: "refactor-auth" };
  it("fires at >= 3x median with >= 3 samples, once", () => {
    expect(BUDGET_VARIANCE_MULTIPLE).toBe(3);
    expect(BUDGET_VARIANCE_MIN_SAMPLES).toBe(3);
    const r = evaluateBudget({
      burn: { burnTokens: 150_000, measuredEvents: 10, unmeasuredEvents: 0 },
      limit, historicalBurns: [40_000, 50_000, 48_000], announced: NONE,
    });
    expect(r.lines.some((l) => l.includes("variance"))).toBe(true);
    expect(r.announced.variance).toBe(true);
  });
  it("does NOT fire at 2 samples or below 3x", () => {
    for (const historicalBurns of [[40_000, 50_000], [50_000, 50_000, 50_000]]) {
      const burnTokens = historicalBurns.length === 2 ? 150_000 : 149_999;
      const r = evaluateBudget({
        burn: { burnTokens, measuredEvents: 10, unmeasuredEvents: 0 },
        limit, historicalBurns, announced: NONE,
      });
      expect(r.announced.variance).toBe(false);
    }
  });
  it("BUDGET_WARN_RATIO is 0.8", () => {
    expect(BUDGET_WARN_RATIO).toBe(0.8);
  });
});
```
- [ ] Run `pnpm --filter @megasaver/stats exec vitest run test/token-budget-burn.test.ts` — expect `Cannot find module '../src/token-budget-burn.js'`.
- [ ] Implement `packages/stats/src/token-budget-burn.ts`:
```ts
import type { OverlayTokenSaverEvent } from "./event.js";
import type { EffectiveBudget } from "./token-budget.js";

export const BUDGET_WARN_RATIO = 0.8;
export const BUDGET_VARIANCE_MULTIPLE = 3;
export const BUDGET_VARIANCE_MIN_SAMPLES = 3;

export type MeasuredBurn = {
  burnTokens: number;
  measuredEvents: number;
  unmeasuredEvents: number;
};

// Receipts only: returnedTokens is measured at the write boundary
// (packages/stats/src/event.ts); absence means UNMEASURED, never bytes/4.
export function foldMeasuredBurn(events: readonly OverlayTokenSaverEvent[]): MeasuredBurn {
  let burnTokens = 0;
  let measuredEvents = 0;
  let unmeasuredEvents = 0;
  for (const event of events) {
    if (event.returnedTokens === undefined) {
      unmeasuredEvents += 1;
    } else {
      burnTokens += event.returnedTokens;
      measuredEvents += 1;
    }
  }
  return { burnTokens, measuredEvents, unmeasuredEvents };
}

export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export type BudgetAnnouncements = { warn80: boolean; warn100: boolean; variance: boolean };

export type EvaluateBudgetInput = {
  burn: MeasuredBurn;
  limit: EffectiveBudget | null;
  historicalBurns: readonly number[];
  announced: BudgetAnnouncements;
};

export type BudgetEvaluation = { lines: readonly string[]; announced: BudgetAnnouncements };

function scopeLabel(limit: EffectiveBudget): string {
  return limit.taskLabel === undefined ? limit.scope : `${limit.scope} '${limit.taskLabel}'`;
}

export function evaluateBudget(input: EvaluateBudgetInput): BudgetEvaluation {
  const lines: string[] = [];
  const announced = { ...input.announced };
  const { burn, limit } = input;
  const coverage = `${burn.measuredEvents}/${burn.measuredEvents + burn.unmeasuredEvents} events measured`;
  if (limit !== null && burn.burnTokens >= limit.limitTokens && !announced.warn100) {
    lines.push(
      `[Mega Saver budget] EXCEEDED the ${limit.limitTokens}-token ${scopeLabel(limit)} budget: ` +
        `${burn.burnTokens} measured tokens (${coverage}). This is warn-only — nothing is blocked.`,
    );
    announced.warn100 = true;
    announced.warn80 = true;
  } else if (
    limit !== null &&
    burn.burnTokens >= limit.limitTokens * BUDGET_WARN_RATIO &&
    !announced.warn80
  ) {
    const pct = Math.floor((burn.burnTokens / limit.limitTokens) * 100);
    lines.push(
      `[Mega Saver budget] at ${pct}% (>=80%) of the ${limit.limitTokens}-token ` +
        `${scopeLabel(limit)} budget: ${burn.burnTokens} measured tokens (${coverage}).`,
    );
    announced.warn80 = true;
  }
  const median = medianOf(input.historicalBurns);
  if (
    !announced.variance &&
    median !== null &&
    median > 0 &&
    input.historicalBurns.length >= BUDGET_VARIANCE_MIN_SAMPLES &&
    burn.burnTokens >= median * BUDGET_VARIANCE_MULTIPLE
  ) {
    lines.push(
      `[Mega Saver budget] variance alarm: ${burn.burnTokens} measured tokens is >=` +
        `${BUDGET_VARIANCE_MULTIPLE}x the median ${median} of ${input.historicalBurns.length} ` +
        `prior sessions with this task label.`,
    );
    announced.variance = true;
  }
  return { lines, announced };
}
```
- [ ] Export the new symbols from `packages/stats/src/index.ts`.
- [ ] Run `pnpm --filter @megasaver/stats exec vitest run test/token-budget-burn.test.ts` — green.
- [ ] Commit: `feat(stats): budget burn fold and evaluator`

---

### Task 3: Per-session check state file

**Files:**
- `packages/stats/src/token-budget-state.ts` (new)
- `packages/stats/src/index.ts` (add exports)
- `packages/stats/test/token-budget-state.test.ts` (new)

**Interfaces:**
```ts
export const tokenBudgetStateSchema: z.ZodType<TokenBudgetState>;
export type TokenBudgetState = {
  version: 1;
  burnTokens: number;
  measuredEvents: number;
  unmeasuredEvents: number;
  announced: BudgetAnnouncements;
  pendingLines: string[]; // max 8
  updatedAt: string; // ISO datetime with offset
};
export function tokenBudgetStatePath(root: string, workspaceKey: string, liveSessionId: string): string | null; // null when liveSessionId fails isSafeSegment
export function readTokenBudgetState(root: string, workspaceKey: string, liveSessionId: string): TokenBudgetState | null;
export function writeTokenBudgetState(root: string, workspaceKey: string, liveSessionId: string, state: TokenBudgetState): void; // no-op on unsafe segment
```

Steps:

- [ ] Write the failing test (mkdtemp fixture like Task 1; key cases):
  - roundtrip; path is `join(root, "stats", WK, "budget", "state-live-1.json")`.
  - `tokenBudgetStatePath(root, WK, "../evil")` → `null`; `writeTokenBudgetState` with that id writes nothing anywhere (assert `stats/` tree unchanged).
  - corrupt/absent/schema-invalid → `readTokenBudgetState` null.
  - `pendingLines` longer than 8 rejected by schema.
  - on POSIX (`process.platform !== "win32"`), written file mode is 0600 and dir 0700 (assert with `statSync(...).mode & 0o777`; skip assertion on win32 — mirror `packages/stats/test/store-permissions.test.ts` platform guard, see `packages/stats/test/_platform.ts`).
- [ ] Run `pnpm --filter @megasaver/stats exec vitest run test/token-budget-state.test.ts` — expect module-not-found failure.
- [ ] Implement `packages/stats/src/token-budget-state.ts`: schema per interface (`.strict()`, `z.array(z.string()).max(8)`, `z.string().datetime({ offset: true })`); path guarded by `isSafeSegment` from `./safe-segment.js`; write = `mkdirSync(dir, { recursive: true, mode: 0o700 })` + `chmodSync(dir, 0o700)` + tmp file + `renameSync` with file mode 0600 (copy the `writeIntentAt` mechanics from `apps/cli/src/hooks/intent-run.ts`, which lives in-repo as the atomic-single-reader-file precedent); read = existsSync + JSON.parse + safeParse, any failure → null.
- [ ] Export the new symbols from `packages/stats/src/index.ts`; run the test file — green.
- [ ] Run `pnpm --filter @megasaver/stats test` (whole package) — no regressions.
- [ ] Commit: `feat(stats): per-session budget check state`

---

### Task 4: Core §3c re-exports

**Files:**
- `packages/core/src/context-gate.ts` (append one export block)
- `packages/core/test/token-budget-reexport.test.ts` (new)

**Interfaces:** re-export exactly: `TOKEN_BUDGET_LABEL_MAX`, `storedTokenBudgetsSchema`, `type StoredTokenBudgets`, `tokenBudgetsPath`, `readTokenBudgets`, `tokenBudgetsStatus`, `writeTokenBudgets`, `clearTokenBudgets`, `type BudgetScope`, `type EffectiveBudget`, `effectiveSessionBudget`, `BUDGET_WARN_RATIO`, `BUDGET_VARIANCE_MULTIPLE`, `BUDGET_VARIANCE_MIN_SAMPLES`, `type MeasuredBurn`, `foldMeasuredBurn`, `medianOf`, `type BudgetAnnouncements`, `type EvaluateBudgetInput`, `type BudgetEvaluation`, `evaluateBudget`, `tokenBudgetStateSchema`, `type TokenBudgetState`, `tokenBudgetStatePath`, `readTokenBudgetState`, `writeTokenBudgetState` — all `from "@megasaver/stats"`.

Steps:

- [ ] Write the failing test `packages/core/test/token-budget-reexport.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  effectiveSessionBudget,
  evaluateBudget,
  foldMeasuredBurn,
  medianOf,
  readTokenBudgets,
  readTokenBudgetState,
  writeTokenBudgets,
  writeTokenBudgetState,
} from "../src/index.js";

describe("core re-exports the token budget surface (§3c pin)", () => {
  it("all runtime symbols resolve through @megasaver/core", () => {
    for (const fn of [
      effectiveSessionBudget, evaluateBudget, foldMeasuredBurn, medianOf,
      readTokenBudgets, readTokenBudgetState, writeTokenBudgets, writeTokenBudgetState,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });
});
```
- [ ] Run `pnpm --filter @megasaver/core exec vitest run test/token-budget-reexport.test.ts` — expect import errors (symbols not exported).
- [ ] Append the export block to `packages/core/src/context-gate.ts` directly under the existing `readBudget` block (same comment style: `// C1 budget circuit breaker: apps read/write token budgets through core (§3c allow-list rule as above).`). `packages/core/src/index.ts` already re-exports context-gate's surface (this is how `readBudget` reaches `apps/cli/src/commands/savings/budget.ts`) — verify the new names flow through; if `index.ts` enumerates names explicitly at that site, add them there too.
- [ ] Run the test — green. Run `pnpm --filter @megasaver/core test` — no regressions (the dependency-direction tests must stay green; stats is already an allowed core dep).
- [ ] Commit: `feat(core): re-export token budget surface`

---

### Task 5: Hook wiring — warn pre-stdout, refresh post-stdout

**Files:**
- `apps/cli/src/hooks/budget-run.ts` (new)
- `apps/cli/src/hooks/saver-run.ts` (edit: `renderSaverStdout` signature + `runSaverHookFromProcess` wiring)
- `apps/cli/test/hooks/budget-run.test.ts` (new)
- `apps/cli/test/hooks/saver-run.test.ts` (extend `renderSaverStdout` describe)

**Interfaces:**
```ts
// apps/cli/src/hooks/budget-run.ts
export const BUDGET_HISTORY_SESSION_CAP = 20;
export function maybeReadBudgetWarning(
  storeRoot: string,
  workspaceKey: string,
  liveSessionId: string,
): string | undefined; // SYNC — one state-file read; every failure → undefined
export function refreshBudgetState(input: {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
  now?: () => string;
}): void; // sync, deferred caller-side; never throws

// apps/cli/src/hooks/saver-run.ts
export function renderSaverStdout(decision: SaverDecision, additionalContext?: string): string;
```

Steps:

- [ ] Extend `apps/cli/test/hooks/saver-run.test.ts` `describe("renderSaverStdout")` with three failing cases:
```ts
it("appends additionalContext to the compress envelope", () => {
  const s = renderSaverStdout({ updatedToolOutput: { stdout: "X", stderr: "" } }, "WARN LINE");
  const parsed = JSON.parse(s) as {
    hookSpecificOutput: { hookEventName: string; updatedToolOutput?: unknown; additionalContext?: string };
  };
  expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
  expect(parsed.hookSpecificOutput.additionalContext).toBe("WARN LINE");
  expect(parsed.hookSpecificOutput.updatedToolOutput).toBeDefined();
});

it("emits a context-only envelope on passthrough with a warning", () => {
  const s = renderSaverStdout({ passthrough: true }, "WARN LINE");
  const parsed = JSON.parse(s) as {
    hookSpecificOutput: { updatedToolOutput?: unknown; additionalContext?: string };
  };
  expect(parsed.hookSpecificOutput.additionalContext).toBe("WARN LINE");
  expect("updatedToolOutput" in parsed.hookSpecificOutput).toBe(false);
});

it("still emits nothing on passthrough without a warning (contract preserved)", () => {
  expect(renderSaverStdout({ passthrough: true })).toBe("");
  expect(renderSaverStdout({ passthrough: true }, undefined)).toBe("");
});
```
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/hooks/saver-run.test.ts` — expect the three new cases red (extra argument ignored / envelope shape mismatch).
- [ ] Update `renderSaverStdout` in `apps/cli/src/hooks/saver-run.ts`:
```ts
export function renderSaverStdout(decision: SaverDecision, additionalContext?: string): string {
  const compressed = "updatedToolOutput" in decision;
  if (!compressed && additionalContext === undefined) return "";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      ...(compressed ? { updatedToolOutput: decision.updatedToolOutput } : {}),
      // ASSUMPTION (spec Open Q1): Claude Code honors additionalContext on
      // PostToolUse (PreToolUse precedent: guard-run.ts). Verified in smoke.
      ...(additionalContext !== undefined ? { additionalContext } : {}),
    },
  });
}
```
- [ ] Rerun — the extended `renderSaverStdout` describe is green.
- [ ] Write the failing test `apps/cli/test/hooks/budget-run.test.ts` (real temp store, injected clock, NO timers). Setup: mkdtemp `root`; `WK = encodeWorkspaceKey("/Users/x/proj")` (import from `@megasaver/shared`); seed overlay events by writing the events JSONL directly with `overlayTokenSaverEventSchema`-valid rows (same shape as the Task 2 `ev()` helper) at the path used by `readOverlayEvents` — derive it the way `packages/stats/test/read-events.test.ts` does; seed budgets with `writeTokenBudgets` (via `@megasaver/core`). Cases:
  - no budgets.json → `refreshBudgetState` writes nothing; `maybeReadBudgetWarning` → undefined.
  - budget 1000, seeded events fold to 850 measured → after one `refreshBudgetState`, `maybeReadBudgetWarning` returns a string containing `"80%"` wording and the joined pending lines; state `announced.warn80 === true`.
  - second `refreshBudgetState` with unchanged events → `pendingLines` becomes `[]` (announced-flag dedupe) and `maybeReadBudgetWarning` → undefined.
  - burn crosses 1000 after appending one more event row → next refresh queues the EXCEEDED line exactly once.
  - variance: label `"t1"` on `live-1`, sibling labeled sessions `live-2..live-4` seeded with folds 40/50/48 tokens and current 150 → refresh queues the variance line once; sibling cap honored (`BUDGET_HISTORY_SESSION_CAP` exported and used).
  - corrupt budgets.json → refresh is a no-op (fail-open, no throw).
  - unsafe `liveSessionId` (`"../evil"`) → both functions no-op/undefined.
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/hooks/budget-run.test.ts` — module-not-found red.
- [ ] Implement `apps/cli/src/hooks/budget-run.ts`. All imports from `@megasaver/core` (§3c) and `node:` only:
```ts
import {
  type BudgetAnnouncements,
  type TokenBudgetState,
  evaluateBudget,
  effectiveSessionBudget,
  foldMeasuredBurn,
  readOverlayEvents,
  readTokenBudgetState,
  readTokenBudgets,
  tokenBudgetsStatus,
  writeTokenBudgetState,
} from "@megasaver/core";

export const BUDGET_HISTORY_SESSION_CAP = 20;
const NO_ANNOUNCEMENTS: BudgetAnnouncements = { warn80: false, warn100: false, variance: false };

// HOT PATH: one synchronous small-file read (same cost class as
// readSessionIntent). Never throws, never awaits, never writes.
export function maybeReadBudgetWarning(
  storeRoot: string,
  workspaceKey: string,
  liveSessionId: string,
): string | undefined {
  try {
    const state = readTokenBudgetState(storeRoot, workspaceKey, liveSessionId);
    if (state === null || state.pendingLines.length === 0) return undefined;
    return state.pendingLines.join("\n");
  } catch {
    return undefined;
  }
}

// DEFERRED (post-stdout, the maybeRunOverlayGc slot): folds receipts and
// rewrites the state file. Sync on purpose — zero awaited I/O anywhere.
export function refreshBudgetState(input: {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
  now?: () => string;
}): void {
  try {
    const { storeRoot, workspaceKey, liveSessionId } = input;
    if (tokenBudgetsStatus(storeRoot, workspaceKey) !== "ok") return; // absent OR corrupt: fail-open
    const budgets = readTokenBudgets(storeRoot, workspaceKey);
    if (budgets === null) return;
    const store = { root: storeRoot };
    const burn = foldMeasuredBurn(readOverlayEvents(store, workspaceKey, liveSessionId));
    const limit = effectiveSessionBudget(budgets, liveSessionId);
    const label = budgets.labels[liveSessionId];
    // Spec Locked #5: "historical" samples are approximated as any OTHER
    // labeled session with >= 1 measured event — no completion marker
    // exists, so in-flight siblings may deflate the median (advisory noise).
    const siblings =
      label === undefined
        ? []
        : Object.entries(budgets.labels)
            .filter(([sid, l]) => l === label && sid !== liveSessionId)
            .slice(-BUDGET_HISTORY_SESSION_CAP)
            .map(([sid]) => foldMeasuredBurn(readOverlayEvents(store, workspaceKey, sid)))
            .filter((b) => b.measuredEvents > 0)
            .map((b) => b.burnTokens);
    const prior = readTokenBudgetState(storeRoot, workspaceKey, liveSessionId);
    const announced = prior?.announced ?? NO_ANNOUNCEMENTS;
    const result = evaluateBudget({ burn, limit, historicalBurns: siblings, announced });
    const state: TokenBudgetState = {
      version: 1,
      burnTokens: burn.burnTokens,
      measuredEvents: burn.measuredEvents,
      unmeasuredEvents: burn.unmeasuredEvents,
      announced: result.announced,
      pendingLines: [...result.lines].slice(0, 8),
      updatedAt: (input.now ?? (() => new Date().toISOString()))(),
    };
    writeTokenBudgetState(storeRoot, workspaceKey, liveSessionId, state);
  } catch {
    /* best-effort; a budget failure must never surface in the hook */
  }
}
```
- [ ] Wire `runSaverHookFromProcess` in `apps/cli/src/hooks/saver-run.ts` (payload fields parsed the same way `decide()` reads them — `session_id` + `cwd` strings; `encodeWorkspaceKey` from `@megasaver/shared` is already imported by `saver.ts`). ORDERING DEPENDENCY: the session-mesh plan (build-order 1, `docs/superpowers/plans/2026-08-06-session-mesh.md` Task 9) edits this same function first — its heartbeat + claim-refresh block also lands after the primary output decision. The snippet below is anchored on the CURRENT body; rebase it on the mesh-modified body at implementation time, keeping `maybeReadBudgetWarning` before `process.stdout.write` and `refreshBudgetState` after it, alongside the mesh heartbeat block (the two post-stdout blocks are independent; relative order immaterial):
```ts
// after: const decision = await buildSaverDecision(payload, deps);
const p = payload as Record<string, unknown>;
// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
const budgetSessionId = typeof p["session_id"] === "string" ? p["session_id"] : undefined;
// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
const budgetCwd = typeof p["cwd"] === "string" ? p["cwd"] : undefined;
const budgetKeys =
  budgetSessionId !== undefined && budgetCwd !== undefined
    ? { workspaceKey: encodeWorkspaceKey(budgetCwd), liveSessionId: budgetSessionId }
    : undefined;
const warning =
  budgetKeys === undefined
    ? undefined
    : maybeReadBudgetWarning(storeRoot, budgetKeys.workspaceKey, budgetKeys.liveSessionId);
const s = renderSaverStdout(decision, warning);
if (s !== "") process.stdout.write(s);
if ("updatedToolOutput" in decision) await maybeRunOverlayGc(storeRoot);
// C1 circuit breaker: deferred, sync, fire-and-forget — AFTER the stdout write.
if (budgetKeys !== undefined) refreshBudgetState({ storeRoot, ...budgetKeys });
```
- [ ] Add the ordering/sync guard test to `apps/cli/test/hooks/budget-run.test.ts`: assert `maybeReadBudgetWarning` returns a non-Promise (`expect(maybeReadBudgetWarning(root, WK, "live-1")).not.toBeInstanceOf(Promise)`) and — the structural hot-path guard, mimicking the intent of `packages/output-filter/test/no-eager-typescript.test.ts` — that a `maybeReadBudgetWarning` call performs no write anywhere under `root` (snapshot `readdirSync` recursive before/after).
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/hooks/budget-run.test.ts test/hooks/saver-run.test.ts test/hooks/saver.test.ts` — all green (saver.test.ts proves `buildSaverDecision` untouched).
- [ ] Commit: `feat(cli): saver hook emits budget warnings`

---

### Task 6: `mega budget` CLI group

**Files:**
- `apps/cli/src/commands/budget.ts` (new)
- `apps/cli/src/main.ts` (register `budget: budgetCommand` in `subCommands`)
- `apps/cli/test/commands/budget.test.ts` (new)

**Interfaces:**
```ts
export type BudgetIo = { stdout: (line: string) => void; stderr: (line: string) => void };
export type RunBudgetSetInput = BudgetIo & {
  storeRoot: string; cwd: string; tokens: string;
  task?: string; session?: string; json?: boolean;
};
export function runBudgetSet(input: RunBudgetSetInput): 0 | 1;
export type RunBudgetStatusInput = BudgetIo & {
  storeRoot: string; cwd: string; session?: string; json?: boolean;
};
export function runBudgetStatus(input: RunBudgetStatusInput): Promise<0 | 1>; // async: readProxyUsage
export type RunBudgetClearInput = BudgetIo & { storeRoot: string; cwd: string; json?: boolean };
export function runBudgetClear(input: RunBudgetClearInput): 0 | 1;
export const budgetCommand: ReturnType<typeof defineCommand>;
```

Behavior (locked by spec):
- `set` parses `<tokens>` as a positive integer (reject non-integer/`$` — dollars are the Pro savings-goal surface, point at `mega savings budget`); derives `workspaceKey = encodeWorkspaceKey(cwd)`; loads-or-seeds `{ version: 1, sessions: {}, tasks: {}, labels: {} }` and applies: bare → `sessionDefault`; `--session <id>` → `sessions[id]`; `--task <label>` → `tasks[label]`; `--task`+`--session` → `tasks[label]` AND `labels[id] = label`. Corrupt existing file → exit 1 with `tokenBudgetsPath` and `mega budget clear` hint, never overwrite.
- `status` renders one line per configured target: workspace default, each task (with labeled-session count), each budgeted/labeled session with `foldMeasuredBurn(readOverlayEvents(...))` → `burn/limit measured tokens (pct%) — coverage M/N events`, plus median + multiple when the session's label has ≥ `BUDGET_VARIANCE_MIN_SAMPLES` sibling samples. Then the proxy receipt block from `readProxyUsage({ storeRoot })` (`@megasaver/llm-proxy`, CLI import precedent `apps/cli/src/commands/audit/usage.ts`): raw sums of `inputTokens`/`outputTokens`/`cacheReadTokens`/`cacheCreationTokens` + `skippedLines`, labeled `store-wide, not session-scoped (F33)`. No budget file → friendly empty-state line with a `mega budget set` example. `--json` emits the same data structured.
- `clear` calls `clearTokenBudgets` and confirms.

Steps:

- [ ] Write the failing test `apps/cli/test/commands/budget.test.ts` — handler-function pattern with collected `stdout` lines (mirror `apps/cli/test/commands/savings.test.ts` mkdtemp + line-collector setup; no Citty invocation). Cases:
  - set bare / `--session` / `--task` / `--task --session` each produce the right `budgets.json` (assert via `readTokenBudgets` through `@megasaver/core`), exit 0, human line contains scope + amount.
  - set rejects `0`, `-5`, `abc`, `$20` (exit 1; `$20` message mentions `mega savings budget`).
  - set onto a corrupt file → exit 1, message contains the path and `mega budget clear`, file bytes unchanged.
  - status empty store → exit 0, contains `mega budget set`.
  - status with seeded budgets + seeded overlay events JSONL (reuse the Task 5 seeding helper): line contains `850/1000` and `85` and `coverage 3/4`; variance line appears only with 3 labeled siblings.
  - status includes `store-wide, not session-scoped (F33)` iff `proxy-usage/usage.jsonl` exists (seed via `appendProxyUsage` from `@megasaver/llm-proxy`).
  - clear removes the dir; `tokenBudgetsStatus` → absent.
  - `--json` variants parse as JSON and carry `{ budgets, sessions: [...], proxy }`.
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/commands/budget.test.ts` — module-not-found red.
- [ ] Implement `apps/cli/src/commands/budget.ts`: handlers per interface (imports: token-budget surface from `@megasaver/core`; `readProxyUsage` from `@megasaver/llm-proxy`; `encodeWorkspaceKey` from `@megasaver/shared`; `readStoreEnv`/`resolveStorePath` from `../store.js` — the `savingsBudgetCommand` wiring shape at `apps/cli/src/commands/savings/budget.ts`). Citty `defineCommand` group `set`/`status`/`clear`; meta description for `set` cross-references `mega savings budget` (savings GOAL) vs this spend LIMIT. NO entitlement gate (spec Open Q2 default: free).
- [ ] Register in `apps/cli/src/main.ts` `subCommands` alphabetically near `brain:`: `budget: budgetCommand,` with the import at the top.
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/commands/budget.test.ts` — green.
- [ ] Run `pnpm --filter @megasaver/cli test` — full CLI suite green.
- [ ] Commit: `feat(cli): mega budget set/status/clear`

---

### Task 7: Verify, changeset, evidence

**Files:**
- `.changeset/budget-circuit-breaker.md` (new)
- (no conventions/docs source changes — no managed-file edits, so no `pnpm conventions:sync` run needed)

Steps:

- [ ] Run `pnpm verify` from repo root — lint + typecheck + full test suite green (DoD #4). Fix any Biome `noPropertyAccessFromIndexSignature`/format fallout inside the new files only.
- [ ] Add `.changeset/budget-circuit-breaker.md`: minor bumps for `@megasaver/stats`, `@megasaver/core`, `@megasaver/cli` — "Budget circuit breaker: per-session/per-task token budgets (`mega budget set/status/clear`), 80%/100% warn-only hook warnings via PostToolUse additionalContext, 3x-median variance alarm over measured receipts."
- [ ] Smoke evidence (DoD #5, capture the terminal session): in a scratch workspace with the saver enabled — `mega budget set 1000 --task smoke --session <live-session-id>`; drive two large compressing tool outputs through the hook (the `saver-roundtrip.test.ts` harness shows how to feed stdin payloads to `mega hooks saver`); show the second invocation's stdout envelope carrying the 80%/EXCEEDED `additionalContext`; run `mega budget status` and capture the table. This smoke also settles spec Open Q1 (ASSUMPTION: PostToolUse `additionalContext` honored by Claude Code) — if a live Claude Code session ignores it, file the fallback noted in the spec before merge.
- [ ] Request review per §9.6: `code-reviewer` AND `critic` in fresh contexts (risk HIGH); then `verifier` with the smoke capture.
- [ ] Update wiki: new page `wiki/concepts/budget-circuit-breaker.md` (mechanism + honest-metrics constraints + F33 limitation), touch `wiki/entities/stats.md` (new modules) and `wiki/entities/cli.md` (`mega budget`), append `wiki/log.md`.
- [ ] Commit: `chore: changeset for budget circuit breaker`

---

## Self-review notes

- Coverage: every spec component (store, math, state, re-export, hook, CLI) has a task; warn-only/fail-open asserted in Tasks 2, 5; percentile math on fixed fixtures (Task 2); no timing-dependent tests anywhere.
- Placeholder scan: all paths/symbols are concrete; pre-existing symbols cited with their defining files (`atomicWriteFile` → `packages/stats/src/atomic-write.ts`, `isSafeSegment` → `packages/stats/src/safe-segment.ts`, `readOverlayEvents` → `packages/stats/src/store.ts` re-exported at `packages/core/src/context-gate.ts`, `encodeWorkspaceKey` → `packages/shared/src/workspace-key.ts`, `readProxyUsage` → `packages/llm-proxy/src/store.ts`, `renderSaverStdout`/`runSaverHookFromProcess` → `apps/cli/src/hooks/saver-run.ts`).
- Type consistency: `EffectiveBudget` defined once (Task 1), consumed by `evaluateBudget` (Task 2) and `budget-run` (Task 5); `BudgetAnnouncements` defined in Task 2, embedded in Task 3's state schema; `exactOptionalPropertyTypes` respected via conditional spreads.
