# Bench-Replay Real Gate Run Implementation Plan (Child-Spec #2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Reviewers:** HIGH risk — `architect` and `critic` must review in separate context windows before merge.

**Goal:** Make the replay harness prove its own cache isolation against the live API, refuse to start a run it cannot afford, and survive a mid-run failure without re-paying for completed work — so that A4's one open term, `S`, can finally be measured or honestly refused.

**Architecture:** Three pure, independently testable modules added to `@megasaver/bench-replay` (`isolation-probe.ts`, `budget.ts`, `run-journal.ts`), each driven by the existing `Send` seam so every test runs against a fake upstream with zero API spend. The probe is the gate: it derives its signal from the API's own `usage` composition, because the harness already learned that a test asserting what we *send* cannot see what the platform *does with it*. Only Task 4 touches real money, and it is an operator runbook, not code.

**Tech Stack:** TypeScript strict ESM, Vitest, Zod, Biome. Existing seams reused: `namespaceCacheRun` / `stripCacheNamespace` / `cacheRunSlot` / `GENERATION_CAP_TOKENS` (`src/transform.ts`), `simulateCacheCost` (`src/cache-model.ts`), `normalizedCostUsd` (`@megasaver/stats`), `Send` / `SendResult` / `RequestUsage` / `ArmUsage` / `ArmIntegrity` (`src/types.ts`, `src/replay.ts`).

## Global Constraints

- **Probe gates spending.** No paid replay may run until `isolationLive === true`.
- **`k = 1`** for the probe: one request per run, so no intra-run warming can confound read attribution.
- **Probe slots must not collide with gate slots.** `cacheRunSlot` yields 0–3 for the four arm runs; the probe uses 90/91/92 so it cannot warm a namespace the gate run later reads.
- **Constants, not knobs.** `MAX_BYTE_RATIO = 0.95`, `MIN_DRIFT_SMOKE_TOLERANCE = 0.1`, default `orderTolerance = 0.15`. Changing one to obtain a verdict is tuning the instrument to the answer.
- **`SAFETY_FACTOR = 1.3`** on every budget estimate.
- **Balanced mode only.** `.megasaver/policy.json` declares `{"modeFloor":"balanced"}`; `clampModeToFloor` refuses aggressive on this tree. Relaxing the policy to obtain a number is forbidden.
- **A partially sent arm run never feeds a verdict.** Its receipts are retained; its numbers are not.
- **The offline cache model may not be recalibrated** against the run it validates.
- **No savings claim may be published** from this work, in either outcome.
- **Typed refusals.** Assert on discriminated results / error `code`, never on message substrings (child-spec #1 precedent: `TelemetryValidationError.code`).
- TS strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ESM `.js` import specifiers.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/bench-replay/src/isolation-probe.ts` (create) | Four single-request sends in two cells; derives `isolationLive` from `usage`. No I/O, no CLI. |
| `packages/bench-replay/test/isolation-probe.test.ts` (create) | Fake upstreams: marker-stripping, marker-honouring, never-warming. |
| `packages/bench-replay/src/budget.ts` (create) | Pre-flight cost estimate from the recording + refusal decision. Pure. |
| `packages/bench-replay/test/budget.test.ts` (create) | Hand-computed fixture, refusal boundary, missing-budget behaviour. |
| `packages/bench-replay/src/run-journal.ts` (create) | Arm-run-boundary journal: append, load, filter partials, namespace allocation on resume. Pure (serialisation only; callers own the file). |
| `packages/bench-replay/test/run-journal.test.ts` (create) | Partial exclusion, resume selection, recording-id mismatch refusal. |
| `packages/bench-replay/src/index.ts` (modify) | Export the three modules' public surface. |
| `docs/superpowers/plans/2026-08-01-bench-replay-real-gate-run-runbook.md` (create, Task 4) | Operator procedure for the paid run + evidence checklist. |

---

## Task 1: Live cache-isolation probe

**Files:**
- Create: `packages/bench-replay/src/isolation-probe.ts`
- Test: `packages/bench-replay/test/isolation-probe.test.ts`

**Interfaces:**
- Consumes: `namespaceCacheRun(body, slot)`, `stripCacheNamespace(body)` from `../src/transform.js`; `Send`, `SendResult` from `../src/replay.js`; `RecordedRequest`, `RequestUsage` from `../src/types.js`.
- Produces: `runIsolationProbe(input: IsolationProbeInput): Promise<IsolationProbeResult>`, `PROBE_SLOTS`, `NEG_READ_RATIO_CEILING`.

- [ ] **Step 1: Write the failing test file**

Create `packages/bench-replay/test/isolation-probe.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { PROBE_SLOTS, runIsolationProbe } from "../src/isolation-probe.js";
import { cacheNamespaceMarker, stripCacheNamespace } from "../src/transform.js";
import type { Send } from "../src/replay.js";
import type { RecordedRequest } from "../src/types.js";

const PREFIX_TOKENS = 60_000;

// One recorded request whose system array carries a cache_control breakpoint on
// system[2], mirroring the real corpus: system[0] is the billing header the
// platform strips, system[2] is the first breakpoint.
function recording(): RecordedRequest[] {
  return [
    {
      model: "claude-opus-5",
      max_tokens: 1,
      system: [
        { type: "text", text: "x-anthropic-billing-header: cch=abc123" },
        { type: "text", text: "You are Claude Code." },
        { type: "text", text: "TOOLS...", cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: "hello" }],
    } as unknown as RecordedRequest,
  ];
}

// Simulates the platform. `stripsMarker: true` reproduces the real defect: the
// block carrying the namespace marker is removed before the cache key is
// computed, so all four sends key identically and the isolation is inert.
function fakeUpstream(opts: { stripsMarker: boolean; neverWarms?: boolean }): Send {
  const cache = new Set<string>();
  return async (body) => {
    if (opts.neverWarms) {
      return { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 };
    }
    const effective = opts.stripsMarker ? stripCacheNamespace(body) : body;
    const key = JSON.stringify(effective.system ?? "");
    if (cache.has(key)) {
      return { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: PREFIX_TOKENS, output_tokens: 1 };
    }
    cache.add(key);
    return { input_tokens: 10, cache_creation_input_tokens: PREFIX_TOKENS, cache_read_input_tokens: 0, output_tokens: 1 };
  };
}

describe("isolation-probe", () => {
  it("reports isolationLive when the platform honours the namespace marker", async () => {
    const result = await runIsolationProbe({ recording: recording(), send: fakeUpstream({ stripsMarker: false }) });

    expect(result.positiveControlWarmed).toBe(true);
    expect(result.posCell.runB.cacheReadTokens).toBe(PREFIX_TOKENS);
    expect(result.negCell.runB.cacheReadTokens).toBe(0);
    expect(result.negReadRatio).toBe(0);
    expect(result.isolationLive).toBe(true);
    expect(result.refusal).toBeUndefined();
  });

  it("reports isolationLive=false when the platform strips the marker block", async () => {
    const result = await runIsolationProbe({ recording: recording(), send: fakeUpstream({ stripsMarker: true }) });

    expect(result.positiveControlWarmed).toBe(true);
    expect(result.negCell.runB.cacheReadTokens).toBe(PREFIX_TOKENS);
    expect(result.negReadRatio).toBe(1);
    expect(result.isolationLive).toBe(false);
  });

  it("refuses rather than passing when the positive control never warms", async () => {
    const result = await runIsolationProbe({ recording: recording(), send: fakeUpstream({ stripsMarker: false, neverWarms: true }) });

    expect(result.positiveControlWarmed).toBe(false);
    expect(result.isolationLive).toBe(false);
    expect(result.refusal).toBe("positive_control_never_warmed");
  });

  it("refuses an empty recording instead of probing nothing", async () => {
    const result = await runIsolationProbe({ recording: [], send: fakeUpstream({ stripsMarker: false }) });

    expect(result.isolationLive).toBe(false);
    expect(result.refusal).toBe("empty_recording");
  });

  // The marker prefix is module-private in transform.ts; build the expected
  // values with the exported `cacheNamespaceMarker` rather than restating it.
  it("sends POS twice on one slot and NEG on two disjoint slots, none colliding with the gate's 0-3", async () => {
    const sent: string[] = [];
    const send: Send = async (body) => {
      const blocks = (body as unknown as { system: { text: string }[] }).system;
      const marked = blocks.find((b) => b.text.startsWith(cacheNamespaceMarker(0).slice(0, 20)));
      sent.push(marked?.text.split("\n")[0] ?? "");
      return { input_tokens: 10, cache_creation_input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 };
    };

    await runIsolationProbe({ recording: recording(), send });

    const expected = (slot: number) => cacheNamespaceMarker(slot).trimEnd();
    expect(sent).toEqual([expected(90), expected(90), expected(91), expected(92)]);

    // The cells must not share a namespace, or NEG.runA reads POS's entry and
    // the cell measures nothing. And no probe slot may equal a gate slot (0-3),
    // or the probe warms a namespace the gate run needs cold.
    for (const slot of [PROBE_SLOTS.pos, PROBE_SLOTS.negA, PROBE_SLOTS.negB]) {
      expect(slot).toBeGreaterThan(3);
    }
    expect(new Set([PROBE_SLOTS.pos, PROBE_SLOTS.negA, PROBE_SLOTS.negB]).size).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @megasaver/bench-replay exec vitest run test/isolation-probe.test.ts`
Expected: FAIL — `Failed to resolve import "../src/isolation-probe.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/bench-replay/src/isolation-probe.ts`:

```typescript
import type { Send } from "./replay.js";
import { namespaceCacheRun } from "./transform.js";
import type { RecordedRequest, RequestUsage } from "./types.js";

// Disjoint from cacheRunSlot's 0-3. A probe run sharing a gate slot would warm
// the namespace the gate run is about to measure cold.
export const PROBE_SLOTS = { pos: 90, negA: 91, negB: 92 } as const;

// Decisive, not tight: live isolation drives the ratio to ~0 and inert
// isolation to ~1. A value in between means the mechanism is partially
// effective and needs investigation, not a threshold adjustment.
export const NEG_READ_RATIO_CEILING = 0.1;

export type IsolationProbeRefusal = "empty_recording" | "positive_control_never_warmed";

export interface IsolationProbeInput {
  recording: readonly RecordedRequest[];
  send: Send;
  // k is fixed at 1: one request per run, so the only possible source of a
  // cache_read is ANOTHER run. A multi-request run would read its own earlier
  // entry and the read could not be attributed.
}

export interface IsolationProbeResult {
  posCell: { runA: RequestUsage; runB: RequestUsage };
  negCell: { runA: RequestUsage; runB: RequestUsage };
  positiveControlWarmed: boolean;
  negReadRatio: number;
  isolationLive: boolean;
  refusal?: IsolationProbeRefusal;
}

const ZERO: RequestUsage = {
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
};

export async function runIsolationProbe(input: IsolationProbeInput): Promise<IsolationProbeResult> {
  const first = input.recording[0];
  if (!first) {
    return {
      posCell: { runA: ZERO, runB: ZERO },
      negCell: { runA: ZERO, runB: ZERO },
      positiveControlWarmed: false,
      negReadRatio: 0,
      isolationLive: false,
      refusal: "empty_recording",
    };
  }

  const sendSlot = async (slot: number): Promise<RequestUsage> => {
    const result = await input.send(namespaceCacheRun(first, slot));
    return {
      inputTokens: result.input_tokens ?? 0,
      cacheCreationTokens: result.cache_creation_input_tokens ?? 0,
      cacheReadTokens: result.cache_read_input_tokens ?? 0,
      outputTokens: result.output_tokens ?? 0,
    };
  };

  // Order matters: POS first, so its entry exists before NEG asks whether a
  // different namespace can reach it.
  const posA = await sendSlot(PROBE_SLOTS.pos);
  const posB = await sendSlot(PROBE_SLOTS.pos);
  const negA = await sendSlot(PROBE_SLOTS.negA);
  const negB = await sendSlot(PROBE_SLOTS.negB);

  const positiveControlWarmed = posB.cacheReadTokens > 0;
  if (!positiveControlWarmed) {
    // Without an observed read, negB.cacheReadTokens === 0 is uninformative: it
    // is equally consistent with working isolation and with a cache that never
    // engaged at all.
    return {
      posCell: { runA: posA, runB: posB },
      negCell: { runA: negA, runB: negB },
      positiveControlWarmed: false,
      negReadRatio: 0,
      isolationLive: false,
      refusal: "positive_control_never_warmed",
    };
  }

  const negReadRatio = negB.cacheReadTokens / posB.cacheReadTokens;
  return {
    posCell: { runA: posA, runB: posB },
    negCell: { runA: negA, runB: negB },
    positiveControlWarmed: true,
    negReadRatio,
    isolationLive: negReadRatio < NEG_READ_RATIO_CEILING,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @megasaver/bench-replay exec vitest run test/isolation-probe.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify the mutations are caught**

Apply each mutation, confirm at least one test fails, then revert:

| # | Mutation | Must fail |
|---|---|---|
| 1 | `PROBE_SLOTS.pos = 0` | slot-disjointness test |
| 2 | Swap `posB` / `negB` in the ratio | honours-marker + strips-marker tests |
| 3 | `negReadRatio < NEG_READ_RATIO_CEILING` → `>` | honours-marker test |
| 4 | Drop the `positiveControlWarmed` guard | never-warms test |
| 5 | Send `PROBE_SLOTS.negB` twice instead of `negA`, `negB` | strips-marker test (ratio still 1, but negA/negB assertions diverge) |

Record the outcome of each in the commit body.

- [ ] **Step 6: Commit**

```bash
git add packages/bench-replay/src/isolation-probe.ts packages/bench-replay/test/isolation-probe.test.ts
git commit -m "feat(bench-replay): probe cache isolation at the API"
```

---

## Task 2: Pre-flight budget refusal

**Files:**
- Create: `packages/bench-replay/src/budget.ts`
- Test: `packages/bench-replay/test/budget.test.ts`

**Interfaces:**
- Consumes: `simulateCacheCost(bodies, { bytesPerToken })` from `./cache-model.js`; `GENERATION_CAP_TOKENS` from `./transform.js`; `normalizedCostUsd` from `@megasaver/stats`.
- Produces: `estimateGateRunBudget(input: BudgetInput): BudgetEstimate`, `SAFETY_FACTOR`, `ARM_RUNS`.

- [ ] **Step 1: Write the failing test**

Create `packages/bench-replay/test/budget.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ARM_RUNS, SAFETY_FACTOR, estimateGateRunBudget } from "../src/budget.js";
import type { RecordedRequest } from "../src/types.js";

function bodies(count: number): RecordedRequest[] {
  return Array.from({ length: count }, (_, i) => ({
    model: "claude-opus-5",
    max_tokens: 1,
    system: [{ type: "text", text: "S".repeat(4_000), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: "u".repeat(1_000 * (i + 1)) }],
  })) as unknown as RecordedRequest[];
}

describe("budget", () => {
  // Deliberately NOT re-deriving the estimate with simulateCacheCost +
  // normalizedCostUsd: that asserts the implementation against itself and passes
  // for any wrong-but-consistent formula. These check properties a wrong
  // implementation would break.
  it("prices all four arm runs, not one", () => {
    const estimate = estimateGateRunBudget({ recording: bodies(6), bytesPerToken: 2.6 });

    expect(ARM_RUNS).toBe(4);
    expect(estimate.perArmRunUsd).toBeGreaterThan(0);
    expect(estimate.estimatedUsd).toBeCloseTo(estimate.perArmRunUsd * ARM_RUNS, 10);
    expect(estimate.breakdown.requests).toBe(6 * ARM_RUNS);
  });

  it("grows with the recording — it is not a constant wearing a dollar sign", () => {
    const small = estimateGateRunBudget({ recording: bodies(6), bytesPerToken: 2.6 });
    const large = estimateGateRunBudget({ recording: bodies(18), bytesPerToken: 2.6 });

    expect(large.estimatedUsd).toBeGreaterThan(small.estimatedUsd);
  });

  it("refuses to start when the safety-adjusted estimate exceeds the budget", () => {
    const recording = bodies(6);
    const bare = estimateGateRunBudget({ recording, bytesPerToken: 2.6 });
    const tooSmall = bare.estimatedUsd * SAFETY_FACTOR * 0.99;

    const estimate = estimateGateRunBudget({ recording, bytesPerToken: 2.6, budgetUsd: tooSmall });

    expect(SAFETY_FACTOR).toBe(1.3);
    expect(estimate.wouldRefuse).toBe(true);
  });

  it("allows a run whose budget clears the safety factor", () => {
    const recording = bodies(6);
    const bare = estimateGateRunBudget({ recording, bytesPerToken: 2.6 });
    const enough = bare.estimatedUsd * SAFETY_FACTOR * 1.01;

    expect(estimateGateRunBudget({ recording, bytesPerToken: 2.6, budgetUsd: enough }).wouldRefuse).toBe(false);
  });

  it("still reports an estimate when no budget was supplied, and does not refuse", () => {
    const estimate = estimateGateRunBudget({ recording: bodies(3), bytesPerToken: 2.6 });

    expect(estimate.budgetUsd).toBeUndefined();
    expect(estimate.estimatedUsd).toBeGreaterThan(0);
    expect(estimate.wouldRefuse).toBe(false);
  });

  // Every breakdown field is a TOTAL for the whole gate run. The replay caps
  // generation at GENERATION_CAP_TOKENS (1), so a recording's own max_tokens
  // must not reach the estimate.
  it("prices output at the generation cap across all four runs, not the recorded max_tokens", () => {
    const estimate = estimateGateRunBudget({ recording: bodies(5), bytesPerToken: 2.6 });
    expect(estimate.breakdown.cappedOutputTokens).toBe(5 * ARM_RUNS);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @megasaver/bench-replay exec vitest run test/budget.test.ts`
Expected: FAIL — `Failed to resolve import "../src/budget.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/bench-replay/src/budget.ts`:

```typescript
import { normalizedCostUsd } from "@megasaver/stats";
import { simulateCacheCost } from "./cache-model.js";
import { GENERATION_CAP_TOKENS } from "./transform.js";
import type { RecordedRequest } from "./types.js";

// replayBothOrders sends two arms in each of two orders.
export const ARM_RUNS = 4;

// Covers the model's known cache-creation error being wrong in the cheap
// direction, plus retry overhead. Run 3 died at request 16 of arm 2 on credit
// exhaustion after 34 billed requests; a half-corpus cannot produce a verdict,
// so an over-estimate that refuses is cheaper than an under-estimate that pays.
export const SAFETY_FACTOR = 1.3;

export interface BudgetInput {
  recording: readonly RecordedRequest[];
  bytesPerToken: number;
  budgetUsd?: number;
}

export interface BudgetEstimate {
  estimatedUsd: number;
  perArmRunUsd: number;
  safetyFactor: number;
  budgetUsd: number | undefined;
  wouldRefuse: boolean;
  breakdown: { inputTokens: number; cappedOutputTokens: number; requests: number };
}

export function estimateGateRunBudget(input: BudgetInput): BudgetEstimate {
  const cost = simulateCacheCost(input.recording, { bytesPerToken: input.bytesPerToken });
  const cappedOutputTokens = input.recording.length * GENERATION_CAP_TOKENS;

  const perArmRunUsd = normalizedCostUsd({
    input_tokens: cost.inputTokens,
    cache_creation_input_tokens: cost.cacheCreationTokens,
    cache_read_input_tokens: cost.cacheReadTokens,
    output_tokens: cappedOutputTokens,
  });

  const estimatedUsd = perArmRunUsd * ARM_RUNS;
  const wouldRefuse =
    input.budgetUsd !== undefined && estimatedUsd * SAFETY_FACTOR > input.budgetUsd;

  return {
    estimatedUsd,
    perArmRunUsd,
    safetyFactor: SAFETY_FACTOR,
    budgetUsd: input.budgetUsd,
    wouldRefuse,
    // Every field here is a TOTAL for the whole gate run — one meaning, so a
    // reader never has to ask whether a number is per-run or pooled.
    breakdown: {
      inputTokens: cost.inputTokens * ARM_RUNS,
      cappedOutputTokens: cappedOutputTokens * ARM_RUNS,
      requests: input.recording.length * ARM_RUNS,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @megasaver/bench-replay exec vitest run test/budget.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/bench-replay/src/budget.ts packages/bench-replay/test/budget.test.ts
git commit -m "feat(bench-replay): refuse a run the budget cannot finish"
```

---

## Task 3: Arm-run-boundary journal

**Files:**
- Create: `packages/bench-replay/src/run-journal.ts`
- Test: `packages/bench-replay/test/run-journal.test.ts`

**Interfaces:**
- Consumes: `Arm`, `ArmUsage`, `ArmIntegrity` from `./types.js`.
- Produces: `armRunJournalEntrySchema`, `ArmRunJournalEntry`, `completedRuns`, `pendingRunIndices`, `nextResumeNamespace`, `RESUME_SLOT_BASE`, `JournalRefusal`, `loadJournal`.

- [ ] **Step 1: Write the failing test**

Create `packages/bench-replay/test/run-journal.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  RESUME_SLOT_BASE,
  completedRuns,
  loadJournal,
  nextResumeNamespace,
  pendingRunIndices,
} from "../src/run-journal.js";
import type { ArmRunJournalEntry } from "../src/run-journal.js";

function entry(over: Partial<ArmRunJournalEntry> = {}): ArmRunJournalEntry {
  return {
    recordingId: "rec-big/task_1",
    armRunIndex: 0,
    namespace: 0,
    status: "complete",
    usage: {
      arm: "baseline",
      inputTokens: 10,
      cacheCreationTokens: 100,
      cacheReadTokens: 0,
      outputTokens: 1,
      normalizedCostUsd: 0.01,
      startedAtMs: 1,
      finishedAtMs: 2,
      perRequest: [],
    },
    integrity: {
      applied: 3,
      appliedFraction: 0.5,
      originalBytes: 1000,
      transformedBytes: 600,
      byteRatio: 0.6,
      ok: true,
    },
    ...over,
  } as ArmRunJournalEntry;
}

describe("run-journal", () => {
  it("excludes a partial arm run from the completed set", () => {
    const rows = [entry(), entry({ armRunIndex: 1, status: "partial" })];
    const done = completedRuns(rows, "rec-big/task_1");

    expect(done).toHaveLength(1);
    expect(done[0]?.armRunIndex).toBe(0);
  });

  it("lists a partial run as pending so resume re-sends it", () => {
    const rows = [entry(), entry({ armRunIndex: 1, status: "partial" })];
    expect(pendingRunIndices(rows, "rec-big/task_1")).toEqual([1, 2, 3]);
  });

  it("lists every run as pending for an empty journal", () => {
    expect(pendingRunIndices([], "rec-big/task_1")).toEqual([0, 1, 2, 3]);
  });

  it("allocates a fresh namespace on resume, never reusing a burnt one", () => {
    const rows = [entry({ namespace: 0 }), entry({ armRunIndex: 1, namespace: 1, status: "partial" })];
    const ns = nextResumeNamespace(rows, 1);

    expect(ns).toBeGreaterThanOrEqual(RESUME_SLOT_BASE);
    expect(rows.some((r) => r.namespace === ns)).toBe(false);
  });

  it("refuses a journal recorded against a different recording", () => {
    const rows = [entry({ recordingId: "rec-small/task_9" })];
    expect(() => completedRuns(rows, "rec-big/task_1")).toThrowError(
      expect.objectContaining({ code: "recording_id_mismatch" }),
    );
  });

  it("refuses a malformed journal row rather than silently dropping it", () => {
    expect(() => loadJournal([{ recordingId: "rec-big/task_1" }])).toThrowError(
      expect.objectContaining({ code: "journal_row_invalid" }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @megasaver/bench-replay exec vitest run test/run-journal.test.ts`
Expected: FAIL — `Failed to resolve import "../src/run-journal.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/bench-replay/src/run-journal.ts`:

```typescript
import { z } from "zod";
import { ARM_RUNS } from "./budget.js";

// Resume namespaces start above both the four gate slots (0-3) and the probe
// slots (90-92). A resumed run must never reuse a namespace an earlier attempt
// already warmed, or it inherits that attempt's cache and stops being cold.
export const RESUME_SLOT_BASE = 200;

export type JournalRefusalCode = "recording_id_mismatch" | "journal_row_invalid";

export class JournalRefusal extends Error {
  readonly code: JournalRefusalCode;
  constructor(code: JournalRefusalCode, message?: string) {
    super(message ?? code);
    this.name = "JournalRefusal";
    this.code = code;
  }
}

const requestUsageSchema = z.object({
  inputTokens: z.number(),
  cacheCreationTokens: z.number(),
  cacheReadTokens: z.number(),
  outputTokens: z.number(),
});

export const armRunJournalEntrySchema = z.object({
  recordingId: z.string().min(1),
  armRunIndex: z.number().int().min(0).max(ARM_RUNS - 1),
  namespace: z.number().int().min(0),
  status: z.enum(["complete", "partial"]),
  usage: requestUsageSchema.extend({
    arm: z.enum(["baseline", "megasaver"]),
    normalizedCostUsd: z.number(),
    startedAtMs: z.number(),
    finishedAtMs: z.number(),
    perRequest: z.array(requestUsageSchema),
  }),
  integrity: z.object({
    applied: z.number(),
    appliedFraction: z.number(),
    originalBytes: z.number(),
    transformedBytes: z.number(),
    byteRatio: z.number(),
    ok: z.boolean(),
  }),
});

export type ArmRunJournalEntry = z.infer<typeof armRunJournalEntrySchema>;

export function loadJournal(rows: readonly unknown[]): ArmRunJournalEntry[] {
  return rows.map((row, i) => {
    const parsed = armRunJournalEntrySchema.safeParse(row);
    if (!parsed.success) {
      throw new JournalRefusal(
        "journal_row_invalid",
        `journal row ${i} is not a valid ArmRunJournalEntry: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      );
    }
    return parsed.data;
  });
}

function assertSameRecording(rows: readonly ArmRunJournalEntry[], recordingId: string): void {
  for (const row of rows) {
    if (row.recordingId !== recordingId) {
      throw new JournalRefusal(
        "recording_id_mismatch",
        `journal was recorded against ${row.recordingId}, not ${recordingId}`,
      );
    }
  }
}

// A partial arm run is retained as receipts and excluded here. Splicing a
// half-sent run into a verdict would mix two cache-warming histories into one
// cost object — manufacturing by hand the artefact the namespacing removes.
export function completedRuns(
  rows: readonly ArmRunJournalEntry[],
  recordingId: string,
): ArmRunJournalEntry[] {
  assertSameRecording(rows, recordingId);
  return rows.filter((row) => row.status === "complete");
}

export function pendingRunIndices(
  rows: readonly ArmRunJournalEntry[],
  recordingId: string,
): number[] {
  const done = new Set(completedRuns(rows, recordingId).map((row) => row.armRunIndex));
  return Array.from({ length: ARM_RUNS }, (_, i) => i).filter((i) => !done.has(i));
}

export function nextResumeNamespace(
  rows: readonly ArmRunJournalEntry[],
  armRunIndex: number,
): number {
  const used = new Set(rows.map((row) => row.namespace));
  let candidate = RESUME_SLOT_BASE + armRunIndex * 10;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @megasaver/bench-replay exec vitest run test/run-journal.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/bench-replay/src/run-journal.ts packages/bench-replay/test/run-journal.test.ts
git commit -m "feat(bench-replay): journal arm runs at their boundary"
```

---

## Task 4: Export surface, full verify, and the operator runbook

**Files:**
- Modify: `packages/bench-replay/src/index.ts`
- Create: `docs/superpowers/plans/2026-08-01-bench-replay-real-gate-run-runbook.md`

**Interfaces:**
- Consumes: everything produced by Tasks 1–3.
- Produces: the package's public surface + the paid-run procedure.

- [ ] **Step 1: Write the failing export test**

Append to `packages/bench-replay/test/types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

describe("child-spec #2 public surface", () => {
  it("exports the probe, budget, and journal entry points", () => {
    expect(typeof api.runIsolationProbe).toBe("function");
    expect(typeof api.estimateGateRunBudget).toBe("function");
    expect(typeof api.pendingRunIndices).toBe("function");
    expect(api.PROBE_SLOTS.pos).toBe(90);
    expect(api.SAFETY_FACTOR).toBe(1.3);
    expect(api.RESUME_SLOT_BASE).toBe(200);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @megasaver/bench-replay exec vitest run test/types.test.ts`
Expected: FAIL — `api.runIsolationProbe is not a function`.

- [ ] **Step 3: Add the exports**

Append to `packages/bench-replay/src/index.ts`:

```typescript
export {
  NEG_READ_RATIO_CEILING,
  PROBE_SLOTS,
  runIsolationProbe,
  type IsolationProbeInput,
  type IsolationProbeRefusal,
  type IsolationProbeResult,
} from "./isolation-probe.js";
export {
  ARM_RUNS,
  SAFETY_FACTOR,
  estimateGateRunBudget,
  type BudgetEstimate,
  type BudgetInput,
} from "./budget.js";
export {
  JournalRefusal,
  RESUME_SLOT_BASE,
  armRunJournalEntrySchema,
  completedRuns,
  loadJournal,
  nextResumeNamespace,
  pendingRunIndices,
  type ArmRunJournalEntry,
  type JournalRefusalCode,
} from "./run-journal.js";
```

- [ ] **Step 4: Run the full package suite and the repo gate**

Run: `pnpm --filter @megasaver/bench-replay test`
Expected: PASS, all files, `Type Errors  no errors`.

Run: `pnpm verify`
Expected: 60/60 turbo tasks, conventions sync `ok`.

- [ ] **Step 5: Write the operator runbook**

Create `docs/superpowers/plans/2026-08-01-bench-replay-real-gate-run-runbook.md` with exactly these sections:

1. **Pre-flight (unpaid).** Record or reuse `rec-big/task_1`. Run `estimateGateRunBudget` and print it. If `wouldRefuse` — stop and fund the printed gap.
2. **Probe (paid, 4 short requests).** Run `runIsolationProbe`. Record `posCell`, `negCell`, `negReadRatio`, `isolationLive`.
   - `refusal: "positive_control_never_warmed"` ⇒ the probe cannot see reads. Stop; investigate model id / prefix length / API change. **Do not** proceed.
   - `isolationLive === false` ⇒ isolation is still inert. Stop, record the finding, leave `S` open on a named cause. **This is a legitimate outcome of the spec.**
   - `negReadRatio` between 0.10 and 0.90 ⇒ partially effective. Stop and investigate. **Do not** adjust the ceiling.
3. **Gate run (paid).** `replayBothOrders` on `rec-big/task_1`, balanced, four arm runs. Journal each completed arm run.
4. **Outcome.** Accepted verdict ⇒ record measured `S` beside the modelled `1.199x`; report the delta as the model's calibration error and **do not** refit the model. Refusal ⇒ record which refusal fired with its numbers.
5. **Evidence checklist.** probe output · budget estimate · four journal entries · verdict-or-refusal · the constants used (0.95 / 0.1 / 0.15 / 1.3) shown unchanged.
6. **Claim boundary.** Restate: `S` is corpus-specific, balanced-only, priced on a flat rate card (17/18 opus-5), and **no savings claim may be published**.

- [ ] **Step 6: Commit**

```bash
git add packages/bench-replay/src/index.ts packages/bench-replay/test/types.test.ts docs/superpowers/plans/2026-08-01-bench-replay-real-gate-run-runbook.md
git commit -m "feat(bench-replay): publish gate-run surface and runbook"
```

- [ ] **Step 7: Append the wiki log entry**

Append to `wiki/log.md` (wiki governance requires every operation to log):

```markdown
## [2026-08-01] feat | child-spec #2 landed: the gate run has an instrument

Three modules, no API spend in tests. `runIsolationProbe` derives isolation from
the API's own usage — POS proves a read is observable, NEG asserts it is not —
because the predecessor was inert while every "the bodies differ" test passed.
`estimateGateRunBudget` refuses to start a run whose safety-adjusted cost
exceeds the budget. `run-journal` checkpoints at the arm-run BOUNDARY: a partial
run keeps its receipts and never feeds a verdict.

`S` remains open until the paid run; the runbook is the procedure.
```

Then commit:

```bash
git add wiki/log.md && git commit -m "docs(wiki): record child-spec #2 landing"
```

---

## Review Gates

Per risk-modes §12 (HIGH), before merge:

- [ ] `architect` design pass — fresh context, no memory of authoring.
- [ ] `critic` adversarial pass — fresh context, separate from `architect`.
- [ ] `verifier` — evidence-based check against the spec's §8 DoD.
- [ ] Author ≠ reviewer for all three.

The single question both reviewers must answer: **can the probe be fooled?** The
mechanism it replaces passed every test it had while doing nothing at all.
