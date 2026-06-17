# ContextGate Honest-90 Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "90% reduction" claim honestly measurable — replace the single byte ratio with a token-weighted eligible reduction reported alongside eligible/proxied/passthrough/mediated fractions and a GA gate that pairs reduction with an evidence-sufficiency input, so the headline number can never be inflated by eligibility-set selection or per-output averaging.

**Architecture:** A new pure module `@megasaver/stats/src/honest-metrics.ts` plus a thin persistence + CLI surface. It introduces a per-observation record (`HonestObservation`) tagged with eligibility (`eligible | passthrough | native_observed`) and mediation (`proxy | saver_hook | native`), a pure aggregator (`aggregateHonestMetrics`) that computes token-weighted reduction over the eligible set and the four fractions, a GA-gate check, and a `mega audit honest` report. Token counts reuse `estimateTokens` from `@megasaver/output-filter` (already a `stats` dependency). All math is deterministic and unit-tested.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, tsup, Biome, pnpm/Turbo.

**Source spec:** `docs/superpowers/specs/2026-06-16-contextgate-honest-90-design.md` (HIGH risk), §3–§7. This plan implements the **honest-metrics engine** (the spec's headline). Three slices are deliberately deferred to named follow-on plans, each shipping working software on its own:
- **Plan 2b — Evidence-sufficiency fixtures** (spec §6: `failureEvidenceRecall`, `actionabilityFixturePassRate`). Needs a fixture corpus; the GA gate here accepts the sufficiency score as an *input* so it is testable now and wired later.
- **Plan 2c — Evidence-ledger write wiring** (spec §8): ContextGate writing evidence rows via `@megasaver/evidence-ledger` (Plan 1). Depends on Plan 1 landing.
- **Plan 2d — MCP expansion rules** (spec §11): constraining agent-facing expansion to current-response chunks.

**Risk:** HIGH (changes the public savings claim). Worktree + `code-reviewer` AND `critic` per CLAUDE.md §12.

**Naming (spec §3):** use `ContextGate` / "Mega Saver Mode"; introduce no new subsystem name. This plan adds a module, not a subsystem.

---

## Grounding (verbatim existing surfaces this plan builds on)

- `@megasaver/output-filter` `estimateTokens(text): number` = `Math.ceil(Buffer.byteLength(text,"utf8")/4)` (`packages/output-filter/src/tokens.ts:12`). `FilterDecision = "passthrough" | "light" | "compressed"` (`tokens.ts:8`). `PASSTHROUGH_THRESHOLD_TOKENS = 1200` (`tokens.ts:5`).
- `@megasaver/stats` already aggregates **token-weighted-equivalent** in `appendEvent` (`store.ts`): `savingRatio = bytesSavedTotal / rawBytesTotal` (Σ/Σ, not a per-output mean) and only `decision === "compressed"` outputs emit events (`context-gate/src/record-output.ts`), so passthrough is already excluded from that ratio. The NEW work is reporting the *fractions* (which need the passthrough + native-observed totals that are currently not recorded) and the mediated fraction + GA gate.
- `@megasaver/stats` `aggregateAdoption` + `computeInterception(proxyEligible, nativeEligible)` (`stats/src/metrics.ts`): existing adoption/interception math to extend with `mediatedEligibleFraction`.
- `stats` depends on `@megasaver/output-filter` + `@megasaver/shared` + `zod` (so `estimateTokens` import is allowed; dependency-graph test allow-list unchanged).
- House test style: `packages/stats/test/metrics.test.ts` (zero-division guards, `makeEvent` factory).

---

## File Structure

```
packages/stats/src/
├── honest-metrics.ts        # NEW: enums + HonestObservation + aggregateHonestMetrics + meetsGaGate + classifyEligibility
└── index.ts                 # extend exports
packages/stats/test/
└── honest-metrics.test.ts   # NEW
apps/cli/src/commands/audit/
├── honest.ts                # NEW: `mega audit honest` report
└── index.ts                 # register subcommand
```

---

## Task 1: Eligibility + mediation enums and the observation schema

**Files:** Create `packages/stats/src/honest-metrics.ts`; Test `packages/stats/test/honest-metrics.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import {
  eligibilityClassSchema,
  honestObservationSchema,
  mediationKindSchema,
} from "../src/honest-metrics.js";

describe("honest-metrics enums + observation", () => {
  it("eligibilityClass accepts the three classes", () => {
    for (const c of ["eligible", "passthrough", "native_observed"]) {
      expect(eligibilityClassSchema.safeParse(c).success).toBe(true);
    }
    expect(eligibilityClassSchema.safeParse("other").success).toBe(false);
  });

  it("mediationKind accepts proxy/saver_hook/native", () => {
    for (const m of ["proxy", "saver_hook", "native"]) {
      expect(mediationKindSchema.safeParse(m).success).toBe(true);
    }
    expect(mediationKindSchema.safeParse("mcp").success).toBe(false);
  });

  it("observation requires non-negative token counts and a returned<=raw invariant", () => {
    expect(
      honestObservationSchema.safeParse({
        rawTokens: 1000,
        returnedTokens: 100,
        eligibility: "eligible",
        mediation: "proxy",
      }).success,
    ).toBe(true);
    expect(
      honestObservationSchema.safeParse({
        rawTokens: 100,
        returnedTokens: 200,
        eligibility: "eligible",
        mediation: "proxy",
      }).success,
    ).toBe(false);
    expect(
      honestObservationSchema.safeParse({
        rawTokens: -1,
        returnedTokens: 0,
        eligibility: "passthrough",
        mediation: "native",
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`../src/honest-metrics.js` unresolved)

Run: `pnpm --filter @megasaver/stats test honest-metrics`

- [ ] **Step 3: Create `src/honest-metrics.ts`** (enums + observation)

```typescript
import { z } from "zod";

export const eligibilityClassSchema = z.enum(["eligible", "passthrough", "native_observed"]);
export type EligibilityClass = z.infer<typeof eligibilityClassSchema>;

export const mediationKindSchema = z.enum(["proxy", "saver_hook", "native"]);
export type MediationKind = z.infer<typeof mediationKindSchema>;

export const honestObservationSchema = z
  .object({
    rawTokens: z.number().int().nonnegative(),
    returnedTokens: z.number().int().nonnegative(),
    eligibility: eligibilityClassSchema,
    mediation: mediationKindSchema,
  })
  .strict()
  .superRefine((o, ctx) => {
    if (o.returnedTokens > o.rawTokens) {
      ctx.addIssue({ code: "custom", message: "returnedTokens must not exceed rawTokens.", path: ["returnedTokens"] });
    }
  });
export type HonestObservation = z.infer<typeof honestObservationSchema>;
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/stats test honest-metrics`

- [ ] **Step 5: Commit**

```bash
git add packages/stats/src/honest-metrics.ts packages/stats/test/honest-metrics.test.ts
git commit -m "feat(stats): honest-metrics observation schema + enums"
```

---

## Task 2: `aggregateHonestMetrics` — token-weighted reduction + fractions

**Files:** Modify `src/honest-metrics.ts`; extend `test/honest-metrics.test.ts`

The headline math. Definitions (spec §5):
- `eligibleReduction = 1 - Σreturned(eligible) / Σraw(eligible)` (token-weighted; 0 when no eligible tokens).
- `eligibleTokenFraction = Σraw(eligible) / Σraw(observed)`.
- `proxiedTokenFraction = Σraw(proxy|saver_hook) / Σraw(observed)`.
- `passthroughTokenFraction = Σraw(passthrough) / Σraw(observed)`.
- `mediatedEligibleFraction = Σraw(eligible AND mediation≠native) / Σraw(eligible)`.

- [ ] **Step 1: Write the failing test** — append:

```typescript
import { aggregateHonestMetrics, type HonestObservation } from "../src/honest-metrics.js";

const obs = (o: Partial<HonestObservation>): HonestObservation => ({
  rawTokens: 1000,
  returnedTokens: 100,
  eligibility: "eligible",
  mediation: "proxy",
  ...o,
});

describe("aggregateHonestMetrics", () => {
  it("computes token-weighted eligible reduction (Sigma/Sigma, not per-output mean)", () => {
    // Two eligible outputs: (10000->100) and (1000->900). Per-output mean would be
    // (0.99 + 0.10)/2 = 0.545; token-weighted is 1 - (1000/11000) = 0.909.
    const m = aggregateHonestMetrics([
      obs({ rawTokens: 10000, returnedTokens: 100 }),
      obs({ rawTokens: 1000, returnedTokens: 900 }),
    ]);
    expect(m.eligibleReduction).toBeCloseTo(0.909, 3);
  });

  it("reports eligible / proxied / passthrough fractions of total observed tokens", () => {
    const m = aggregateHonestMetrics([
      obs({ rawTokens: 8000, eligibility: "eligible", mediation: "proxy" }),
      obs({ rawTokens: 1000, returnedTokens: 1000, eligibility: "passthrough", mediation: "native" }),
      obs({ rawTokens: 1000, returnedTokens: 1000, eligibility: "native_observed", mediation: "native" }),
    ]);
    expect(m.rawTokensObserved).toBe(10000);
    expect(m.eligibleTokenFraction).toBeCloseTo(0.8, 5);
    expect(m.passthroughTokenFraction).toBeCloseTo(0.1, 5);
    // proxied = proxy + saver_hook raw tokens / observed
    expect(m.proxiedTokenFraction).toBeCloseTo(0.8, 5);
  });

  it("mediatedEligibleFraction is eligible-mediated raw over all eligible raw", () => {
    const m = aggregateHonestMetrics([
      obs({ rawTokens: 6000, eligibility: "eligible", mediation: "proxy" }),
      obs({ rawTokens: 2000, eligibility: "eligible", mediation: "saver_hook" }),
      // an eligible output that was observed natively (not mediated) — drags the fraction down
      obs({ rawTokens: 2000, returnedTokens: 2000, eligibility: "eligible", mediation: "native" }),
    ]);
    expect(m.mediatedEligibleFraction).toBeCloseTo(0.8, 5); // 8000/10000
  });

  it("returns a defined zero block with no divide-by-zero on empty input", () => {
    const m = aggregateHonestMetrics([]);
    expect(m).toMatchObject({
      eligibleReduction: 0,
      eligibleTokenFraction: 0,
      proxiedTokenFraction: 0,
      passthroughTokenFraction: 0,
      mediatedEligibleFraction: 0,
      rawTokensObserved: 0,
      rawTokensEligible: 0,
      returnedTokensEligible: 0,
    });
  });

  it("passthrough cannot create positive savings: a passthrough-only set has reduction 0", () => {
    const m = aggregateHonestMetrics([obs({ rawTokens: 500, returnedTokens: 500, eligibility: "passthrough", mediation: "native" })]);
    expect(m.eligibleReduction).toBe(0);
    expect(m.rawTokensEligible).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`aggregateHonestMetrics` not exported)

Run: `pnpm --filter @megasaver/stats test honest-metrics`

- [ ] **Step 3: Add to `src/honest-metrics.ts`**

```typescript
export interface HonestMetrics {
  eligibleReduction: number;
  eligibleTokenFraction: number;
  proxiedTokenFraction: number;
  passthroughTokenFraction: number;
  mediatedEligibleFraction: number;
  rawTokensObserved: number;
  rawTokensEligible: number;
  returnedTokensEligible: number;
}

const safeRatio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

export function aggregateHonestMetrics(observations: readonly HonestObservation[]): HonestMetrics {
  let rawObserved = 0;
  let rawEligible = 0;
  let returnedEligible = 0;
  let rawProxied = 0;
  let rawPassthrough = 0;
  let rawEligibleMediated = 0;
  for (const o of observations) {
    rawObserved += o.rawTokens;
    if (o.mediation !== "native") rawProxied += o.rawTokens;
    if (o.eligibility === "passthrough") rawPassthrough += o.rawTokens;
    if (o.eligibility === "eligible") {
      rawEligible += o.rawTokens;
      returnedEligible += o.returnedTokens;
      if (o.mediation !== "native") rawEligibleMediated += o.rawTokens;
    }
  }
  return {
    eligibleReduction: rawEligible === 0 ? 0 : 1 - returnedEligible / rawEligible,
    eligibleTokenFraction: safeRatio(rawEligible, rawObserved),
    proxiedTokenFraction: safeRatio(rawProxied, rawObserved),
    passthroughTokenFraction: safeRatio(rawPassthrough, rawObserved),
    mediatedEligibleFraction: safeRatio(rawEligibleMediated, rawEligible),
    rawTokensObserved: rawObserved,
    rawTokensEligible: rawEligible,
    returnedTokensEligible: returnedEligible,
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/stats test honest-metrics`

- [ ] **Step 5: Commit**

```bash
git add packages/stats/src/honest-metrics.ts packages/stats/test/honest-metrics.test.ts
git commit -m "feat(stats): token-weighted honest metrics aggregator"
```

---

## Task 3: GA gate (reduction paired with sufficiency)

**Files:** Modify `src/honest-metrics.ts`; extend `test/honest-metrics.test.ts`

Spec §6: GA requires BOTH `eligibleReduction >= reductionTarget` AND `actionabilityFixturePassRate >= sufficiencyTarget`. The sufficiency score is an INPUT here (its fixtures land in Plan 2b); this keeps the gate testable now and prevents shipping a reduction number without a sufficiency floor.

- [ ] **Step 1: Write the failing test** — append:

```typescript
import { meetsGaGate } from "../src/honest-metrics.js";

describe("meetsGaGate", () => {
  const targets = { reductionTarget: 0.9, sufficiencyTarget: 0.95 };
  it("passes only when BOTH reduction and sufficiency clear their targets", () => {
    expect(meetsGaGate({ eligibleReduction: 0.92, actionabilityFixturePassRate: 0.96 }, targets)).toMatchObject({
      pass: true,
    });
  });
  it("fails when reduction clears but sufficiency does not (cannot trade evidence for tokens)", () => {
    const r = meetsGaGate({ eligibleReduction: 0.99, actionabilityFixturePassRate: 0.5 }, targets);
    expect(r.pass).toBe(false);
    expect(r.failed).toContain("sufficiency");
  });
  it("fails when sufficiency clears but reduction does not", () => {
    const r = meetsGaGate({ eligibleReduction: 0.7, actionabilityFixturePassRate: 0.99 }, targets);
    expect(r.pass).toBe(false);
    expect(r.failed).toContain("reduction");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`meetsGaGate` not exported)

Run: `pnpm --filter @megasaver/stats test honest-metrics`

- [ ] **Step 3: Add to `src/honest-metrics.ts`**

```typescript
export interface GaGateInput {
  eligibleReduction: number;
  actionabilityFixturePassRate: number;
}
export interface GaGateTargets {
  reductionTarget: number;
  sufficiencyTarget: number;
}
export interface GaGateResult {
  pass: boolean;
  failed: readonly ("reduction" | "sufficiency")[];
}

export function meetsGaGate(input: GaGateInput, targets: GaGateTargets): GaGateResult {
  const failed: ("reduction" | "sufficiency")[] = [];
  if (input.eligibleReduction < targets.reductionTarget) failed.push("reduction");
  if (input.actionabilityFixturePassRate < targets.sufficiencyTarget) failed.push("sufficiency");
  return { pass: failed.length === 0, failed };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/stats test honest-metrics`

- [ ] **Step 5: Commit**

```bash
git add packages/stats/src/honest-metrics.ts packages/stats/test/honest-metrics.test.ts
git commit -m "feat(stats): GA gate pairing reduction with sufficiency floor"
```

---

## Task 4: Classify an output into an observation

**Files:** Modify `src/honest-metrics.ts`; extend `test/honest-metrics.test.ts`

Map a recorded output (decision + token counts + mediation source) into a `HonestObservation`. Eligibility rule (spec §4): `compressed` decision above the passthrough threshold → `eligible`; `passthrough`/`light` → `passthrough`; an output seen only by the native hook log → `native_observed`.

- [ ] **Step 1: Write the failing test** — append:

```typescript
import { classifyObservation } from "../src/honest-metrics.js";

describe("classifyObservation", () => {
  it("compressed mediated output above threshold is eligible", () => {
    expect(
      classifyObservation({ decision: "compressed", rawTokens: 5000, returnedTokens: 400, mediation: "proxy" }),
    ).toEqual({ rawTokens: 5000, returnedTokens: 400, eligibility: "eligible", mediation: "proxy" });
  });

  it("passthrough output is passthrough with returned==raw (no fake savings)", () => {
    expect(
      classifyObservation({ decision: "passthrough", rawTokens: 300, returnedTokens: 300, mediation: "saver_hook" }),
    ).toEqual({ rawTokens: 300, returnedTokens: 300, eligibility: "passthrough", mediation: "saver_hook" });
  });

  it("light decision is treated as passthrough for eligibility (not counted as savings)", () => {
    expect(classifyObservation({ decision: "light", rawTokens: 1500, returnedTokens: 1400, mediation: "proxy" }).eligibility).toBe(
      "passthrough",
    );
  });

  it("native-observed output (from hook log, no mediation) is native_observed + native", () => {
    expect(
      classifyObservation({ decision: "compressed", rawTokens: 9000, returnedTokens: 9000, mediation: "native" }),
    ).toEqual({ rawTokens: 9000, returnedTokens: 9000, eligibility: "native_observed", mediation: "native" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`classifyObservation` not exported)

Run: `pnpm --filter @megasaver/stats test honest-metrics`

- [ ] **Step 3: Add to `src/honest-metrics.ts`** (import the decision type)

Add to the top import group: `import type { FilterDecision } from "@megasaver/output-filter";`

```typescript
export function classifyObservation(input: {
  decision: FilterDecision;
  rawTokens: number;
  returnedTokens: number;
  mediation: MediationKind;
}): HonestObservation {
  // A natively-observed output (hook telemetry only, never mediated by a proxy
  // tool or the saver) is counted as observed-but-not-reduced.
  if (input.mediation === "native") {
    return { rawTokens: input.rawTokens, returnedTokens: input.rawTokens, eligibility: "native_observed", mediation: "native" };
  }
  // Eligibility relies on the invariant that the filter only emits `decision:
  // "compressed"` for outputs above the large-output threshold (output-filter
  // `tokens.ts`: passthrough < PASSTHROUGH_THRESHOLD_TOKENS=1200, light <
  // HARD_WRAP_THRESHOLD_TOKENS=2000, compressed only >= 2000). So `compressed`
  // implies above-threshold and `eligible` needs no separate threshold check.
  // passthrough/light return (near-)everything and must never count as savings.
  const eligibility: EligibilityClass = input.decision === "compressed" ? "eligible" : "passthrough";
  const returnedTokens = eligibility === "eligible" ? input.returnedTokens : input.rawTokens;
  return { rawTokens: input.rawTokens, returnedTokens, eligibility, mediation: input.mediation };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/stats test honest-metrics`

- [ ] **Step 5: Commit**

```bash
git add packages/stats/src/honest-metrics.ts packages/stats/test/honest-metrics.test.ts
git commit -m "feat(stats): classify outputs into honest observations"
```

---

## Task 5: Public exports

**Files:** Modify `packages/stats/src/index.ts`; Test `packages/stats/test/honest-metrics.test-d.ts`

- [ ] **Step 1: Write the failing type-surface test** (`test/honest-metrics.test-d.ts`)

```typescript
import { expectTypeOf } from "vitest";
import * as stats from "../src/index.js";
import type { HonestMetrics, HonestObservation } from "../src/index.js";

expectTypeOf(stats.aggregateHonestMetrics).toBeFunction();
expectTypeOf(stats.classifyObservation).toBeFunction();
expectTypeOf(stats.meetsGaGate).toBeFunction();
expectTypeOf(stats.honestObservationSchema).not.toBeNever();
expectTypeOf<HonestMetrics>().toHaveProperty("eligibleReduction");
expectTypeOf<HonestObservation>().toHaveProperty("eligibility");
```

- [ ] **Step 2: Run typecheck — expect FAIL** (names not exported)

Run: `pnpm --filter @megasaver/stats test honest-metrics`

- [ ] **Step 3: Append to `packages/stats/src/index.ts`** (find the existing export block; add a new export line — do NOT reorder existing exports)

```typescript
export {
  eligibilityClassSchema,
  mediationKindSchema,
  honestObservationSchema,
  aggregateHonestMetrics,
  classifyObservation,
  meetsGaGate,
  type EligibilityClass,
  type MediationKind,
  type HonestObservation,
  type HonestMetrics,
  type GaGateInput,
  type GaGateTargets,
  type GaGateResult,
} from "./honest-metrics.js";
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/stats test honest-metrics`

- [ ] **Step 5: Commit**

```bash
git add packages/stats/src/index.ts packages/stats/test/honest-metrics.test-d.ts
git commit -m "feat(stats): export honest-metrics public surface"
```

---

## Task 6: Aggregate honest metrics from a session's recorded events

**Files:** Modify `src/honest-metrics.ts`; extend `test/honest-metrics.test.ts`

Bridge the on-disk logs into observations. **Data-model fact (verified):** persisted events carry no `mediation`/`decision` field — but the *log they live in* determines both: an `OverlayTokenSaverEvent` (saver-hook path, `record-output.ts`) is by construction a `compressed` `saver_hook` output (overlay events are only appended when `decision === "compressed"`); a session `TokenSaverEvent` (proxy path) is a `compressed` `proxy` output; the hook telemetry log (`mega hooks log`) yields `native_observed`/`native` counts. So mediation/decision are assigned **by the loader from the log source**, not read from the row. This task makes that projection an explicit, tested pure function (`recordedEventsFromLogs`) instead of an untested IO inference. Token counts mirror `estimateTokens` (`Math.ceil(bytes/4)`).

- [ ] **Step 1: Write the failing test** — append:

```typescript
import { estimateTokens } from "@megasaver/output-filter";
import { observationsFromEvents, recordedEventsFromLogs } from "../src/honest-metrics.js";

describe("tokensFromBytes mirrors estimateTokens", () => {
  it("matches estimateTokens for the same content (bytes/4 ceiling)", () => {
    const s = "a".repeat(123);
    // estimateTokens(s) === Math.ceil(Buffer.byteLength(s)/4); the loader uses
    // recorded byte counts, so the two must agree.
    expect(estimateTokens(s)).toBe(Math.ceil(Buffer.byteLength(s, "utf8") / 4));
  });
});

describe("recordedEventsFromLogs (mediation assigned by log source)", () => {
  it("tags overlay events saver_hook, session events proxy, hook-log native", () => {
    const recorded = recordedEventsFromLogs({
      overlayEvents: [{ rawBytes: 8000, returnedBytes: 400 }],
      sessionEvents: [{ rawBytes: 6000, returnedBytes: 300 }],
      nativeEligible: [{ rawBytes: 12000 }],
    });
    expect(recorded).toContainEqual({ rawBytes: 8000, returnedBytes: 400, mediation: "saver_hook", decision: "compressed" });
    expect(recorded).toContainEqual({ rawBytes: 6000, returnedBytes: 300, mediation: "proxy", decision: "compressed" });
    expect(recorded).toContainEqual({ rawBytes: 12000, returnedBytes: 12000, mediation: "native", decision: "compressed" });
  });
});

describe("observationsFromEvents", () => {
  it("turns recorded events into eligible/native observations using bytes/4 tokens", () => {
    const observations = observationsFromEvents([
      // rawBytes 8000 -> 2000 tokens; returnedBytes 400 -> 100 tokens
      { rawBytes: 8000, returnedBytes: 400, mediation: "saver_hook", decision: "compressed" },
      { rawBytes: 12000, returnedBytes: 12000, mediation: "native", decision: "compressed" },
    ]);
    expect(observations).toContainEqual({ rawTokens: 2000, returnedTokens: 100, eligibility: "eligible", mediation: "saver_hook" });
    expect(observations).toContainEqual({ rawTokens: 3000, returnedTokens: 3000, eligibility: "native_observed", mediation: "native" });
  });

  it("a non-compressed recorded event is NOT eligible (no fake savings)", () => {
    const [obs] = observationsFromEvents([
      { rawBytes: 4000, returnedBytes: 4000, mediation: "proxy", decision: "passthrough" },
    ]);
    expect(obs?.eligibility).toBe("passthrough");
    expect(obs?.returnedTokens).toBe(obs?.rawTokens);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`observationsFromEvents` not exported)

Run: `pnpm --filter @megasaver/stats test honest-metrics`

- [ ] **Step 3: Add to `src/honest-metrics.ts`** (NO `estimateTokens` import — `honest-metrics.ts` must not import it, or biome `noUnusedImports` fails verify; the equivalence is asserted in the *test* file where the import is consumed)

```typescript
// Mirror estimateTokens (Math.ceil(bytes/4)) so honest metrics use the same
// token model as the rest of the pipeline. estimateTokens takes a string;
// recorded events only retain byte counts, so apply the identical formula here.
function tokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}

// A persisted event always records a `compressed` mediated output. `decision`
// and `mediation` are REQUIRED — the loader sets them from the log source
// (overlay→saver_hook, session→proxy, hook-telemetry→native); they are never
// read from the row, which does not carry them.
export interface RecordedEventLike {
  rawBytes: number;
  returnedBytes: number;
  mediation: MediationKind;
  decision: FilterDecision;
}

export function observationsFromEvents(
  events: readonly RecordedEventLike[],
): readonly HonestObservation[] {
  return events.map((e) =>
    classifyObservation({
      decision: e.decision,
      rawTokens: tokensFromBytes(e.rawBytes),
      returnedTokens: tokensFromBytes(e.returnedBytes),
      mediation: e.mediation,
    }),
  );
}

// The honest projection from the two on-disk logs + hook telemetry. Mediation
// is assigned by SOURCE, the only place that knows it. Native-eligible outputs
// were observed but never mediated, so returned == raw (no reduction).
export function recordedEventsFromLogs(input: {
  overlayEvents: readonly { rawBytes: number; returnedBytes: number }[];
  sessionEvents: readonly { rawBytes: number; returnedBytes: number }[];
  nativeEligible: readonly { rawBytes: number }[];
}): readonly RecordedEventLike[] {
  return [
    ...input.overlayEvents.map((e) => ({ ...e, mediation: "saver_hook" as const, decision: "compressed" as const })),
    ...input.sessionEvents.map((e) => ({ ...e, mediation: "proxy" as const, decision: "compressed" as const })),
    ...input.nativeEligible.map((n) => ({
      rawBytes: n.rawBytes,
      returnedBytes: n.rawBytes,
      mediation: "native" as const,
      decision: "compressed" as const,
    })),
  ];
}
```

Then extend `packages/stats/src/index.ts` (the honest-metrics export block from Task 5) to also export `observationsFromEvents`, `recordedEventsFromLogs`, and `type RecordedEventLike` from `./honest-metrics.js` — the CLI (Task 7) imports them from the package entry.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/stats test honest-metrics`

- [ ] **Step 5: Commit**

```bash
git add packages/stats/src/honest-metrics.ts packages/stats/src/index.ts packages/stats/test/honest-metrics.test.ts
git commit -m "feat(stats): build honest observations from recorded events + native-eligible"
```

---

## Task 7: `mega audit honest` CLI report

**Files:** Create `apps/cli/src/commands/audit/honest.ts`; Modify `apps/cli/src/commands/audit/index.ts`

Surface the honest metrics for a session/project as a report (and `--json`). Follows the existing `audit` subcommand pattern (`apps/cli/src/commands/audit/index.ts`). The runner reads the session's overlay events + hook-log native-eligible count, builds observations, aggregates, and prints the four fractions + eligible reduction with an explicit "90% applies to eligible mediated context only" caveat (spec §7: may not imply whole-session savings).

- [ ] **Step 1: Write the failing test** (`apps/cli/test/commands/audit-honest.test.ts` — follow the existing audit command test style; assert the runner returns 0 and the JSON shape carries the honest fields)

```typescript
import { describe, expect, it } from "vitest";
import { renderHonestReport } from "../../src/commands/audit/honest.js";

describe("renderHonestReport", () => {
  it("renders the four fractions + eligible reduction + the eligible-only caveat", () => {
    const text = renderHonestReport({
      eligibleReduction: 0.91,
      eligibleTokenFraction: 0.62,
      proxiedTokenFraction: 0.7,
      passthroughTokenFraction: 0.2,
      mediatedEligibleFraction: 0.88,
      rawTokensObserved: 100000,
      rawTokensEligible: 62000,
      returnedTokensEligible: 5580,
    });
    expect(text).toContain("eligible reduction");
    expect(text).toContain("91");
    expect(text).toContain("eligible mediated context"); // the honesty caveat
    expect(text).toContain("eligible token fraction");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`renderHonestReport` unresolved)

Run: `pnpm --filter @megasaver/cli test audit-honest`

- [ ] **Step 3: Create `apps/cli/src/commands/audit/honest.ts`** (renderer + command; mirror the arg/exit pattern of `audit/report` — read `apps/cli/src/commands/audit/report.ts` for the exact `runAuditReport` plumbing and copy its store-resolution + `--json`/`--store` args)

```typescript
import { defineCommand } from "citty";
import type { HonestMetrics } from "@megasaver/stats";

export function renderHonestReport(m: HonestMetrics): string {
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  return [
    `eligible reduction:        ${pct(m.eligibleReduction)} (token-weighted, eligible mediated context only)`,
    `eligible token fraction:   ${pct(m.eligibleTokenFraction)} of observed tokens`,
    `proxied token fraction:    ${pct(m.proxiedTokenFraction)} of observed tokens`,
    `passthrough token fraction:${pct(m.passthroughTokenFraction)} of observed tokens`,
    `mediated eligible fraction:${pct(m.mediatedEligibleFraction)} of eligible tokens`,
    `observed/eligible tokens:  ${m.rawTokensObserved} / ${m.rawTokensEligible}`,
    "",
    "Note: the reduction applies to eligible mediated context only; it does not",
    "imply whole-session savings unless the mediated eligible fraction is high.",
  ].join("\n");
}

export const auditHonestCommand = defineCommand({
  meta: { name: "honest", description: "Honest token-reduction metrics (token-weighted + eligibility fractions)." },
  args: {
    sessionId: { type: "positional", required: true, description: "Live session id." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    // Reuse the audit/report store-resolution + loaders to read the three sources,
    // then run the TESTED pure projection — no mediation is invented here:
    //   const recorded = recordedEventsFromLogs({ overlayEvents, sessionEvents, nativeEligible });
    //   const metrics = aggregateHonestMetrics(observationsFromEvents(recorded));
    //   process.stdout.write(args.json ? JSON.stringify(metrics) : renderHonestReport(metrics));
    // overlayEvents/sessionEvents/nativeEligible come from the existing on-disk logs
    // (overlay stats log, session stats log, hook-telemetry jsonl) via report.ts loaders.
  },
});
```

> The `run()` body only LOADS the three logs (reuse `audit/report.ts` store + loader plumbing — read it first; do not invent a loader) and calls the pure, fully-tested `recordedEventsFromLogs` → `observationsFromEvents` → `aggregateHonestMetrics` → `renderHonestReport`. Mediation is assigned by log source inside `recordedEventsFromLogs` (tested in Task 6), never fabricated in the IO shell. If a session-stats loader does not yet exist, pass `sessionEvents: []` and `log()` that proxy-mediated events are not yet counted (no silent cap).

- [ ] **Step 4: Register in `apps/cli/src/commands/audit/index.ts`** — add `honest: auditHonestCommand` to `subCommands` (alongside `report`/`last`/`session`/`export`).

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @megasaver/cli test audit-honest`

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/audit/honest.ts apps/cli/src/commands/audit/index.ts apps/cli/test/commands/audit-honest.test.ts
git commit -m "feat(cli): mega audit honest report"
```

---

## Task 8: Changeset + full verify + smoke

**Files:** Create `.changeset/contextgate-honest-90.md`

- [ ] **Step 1: Create the changeset**

```markdown
---
"@megasaver/stats": minor
"@megasaver/cli": minor
---

Add honest token-reduction metrics: token-weighted eligible reduction reported
alongside eligible/proxied/passthrough/mediated fractions, a GA gate pairing
reduction with an evidence-sufficiency floor, and `mega audit honest`. Passthrough
outputs never create positive savings; the headline reduction is reported as
eligible-mediated-context-only and cannot be inflated by eligibility-set selection.
```

- [ ] **Step 2: Repo-wide gate**

Run: `pnpm verify`
Expected: PASS — lint + typecheck + test (incl. stats dependency-graph guard unchanged: allow-list still `{output-filter, shared, zod}`) + conventions:check. Run `pnpm lint:fix` first if biome flags import order.

- [ ] **Step 3: Smoke**

Run: `mega audit honest <liveSessionId> --json` on a session with recorded overlay events.
Expected: JSON with `eligibleReduction`, `eligibleTokenFraction`, `proxiedTokenFraction`, `passthroughTokenFraction`, `mediatedEligibleFraction`.

- [ ] **Step 4: Commit**

```bash
git add .changeset/contextgate-honest-90.md
git commit -m "chore(stats): changeset for honest-90 metrics"
```

---

## Self-Review (against contextgate-honest-90-design.md)

- §3 Naming → no new subsystem; a `honest-metrics` module under `stats`. ✓
- §4 Eligibility → `classifyObservation` (compressed-above-threshold = eligible; passthrough/light = passthrough; native = native_observed); passthrough never produces savings. ✓
- §5 Honest metrics → token-weighted `eligibleReduction` + `eligibleTokenFraction` + `proxiedTokenFraction` + `passthroughTokenFraction`; per-output mean explicitly avoided (test contrasts mean vs weighted). ✓
- §6 Sufficiency + GA gate → `meetsGaGate` requires BOTH reduction and sufficiency; sufficiency is an input (fixtures = Plan 2b). ✓ (counters themselves deferred — see scope note)
- §7 Adoption → `mediatedEligibleFraction` + the eligible-only caveat in the report. (Full per-tool adoption extends the existing `aggregateAdoption`; this plan adds the fraction the spec names.) ✓
- §8 Evidence-ledger write → **deferred to Plan 2c** (depends on Plan 1). Noted.
- §11 MCP expansion rules → **deferred to Plan 2d**. Noted.
- §12 Testing → token-weighted math, eligible-fraction, adoption fraction, passthrough-no-savings all covered; sufficiency-recall fixtures are Plan 2b.

**Placeholder scan:** the only non-literal step is Task 7's `run()` IO body, which explicitly says "copy `report.ts` loader verbatim" rather than inventing — the testable logic (`renderHonestReport`, `observationsFromEvents`, `aggregateHonestMetrics`) is fully specified. Flag: the executor must read `apps/cli/src/commands/audit/report.ts` for the loader plumbing.

**Type consistency:** `HonestObservation`/`HonestMetrics`/`EligibilityClass`/`MediationKind`/`FilterDecision` consistent across tasks. `tokensFromBytes` mirrors `estimateTokens`'s `Math.ceil(bytes/4)`.

**Carried scope notes:** Plan 2b (sufficiency fixtures), Plan 2c (evidence write, needs Plan 1), Plan 2d (MCP expansion). Each ships independently.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-16-contextgate-honest-90.md`. Execution options: (1) Subagent-Driven (recommended), (2) Inline. Which approach?
