# Design Spec: Bench-Replay Real Gate Run (Child-Spec #2)

> **Date:** 2026-08-01
> **Package:** `@megasaver/bench-replay` (+ read-only use of `@megasaver/stats`)
> **Risk Level:** **HIGH** — this instrument decides whether a savings claim may
> ever be published, spends real API budget, and its last two runs were both
> refused. A wrong number here misdirects the entire Phase 1 roadmap.
> Per risk-modes §12: architect + critic in separate contexts, own worktree.
> **Spec Status:** DRAFT — awaiting user approval, then architect + critic.
> **Umbrella:** Quantum Context Engine v3 §21.2 child-spec #2; closes Phase 0.
> **Predecessor:** Child-Spec #1 (`2026-08-01-field-telemetry-workspace-stamp-design.md`).

---

## 1. Problem

A4 was reformulated (2026-07-30, user-directed) into a bounded gate:

> **A4 passes iff `S > 0` and `R < R*`.**

| term | meaning | value | basis | status |
|---|---|---|---|---|
| `R*` | break-even recovery rate | **66.7%** | derived offline, 8/8 mutations caught | settled |
| `R` | observed recovery rate | **2.4%** | production ledger, 46 rows | settled (~28x margin) |
| `S` | input-side cost saving | **1.199x** | **modelled only** | **OPEN** |

`S` has never been measured end to end. Two paid attempts, two refusals:

1. **Run 1 — nothing to measure.** Synthetic bench corpus: 288 `tool_result`
   blocks, median 329 B, max 1,991 B. `0 / 288` cleared even the smallest floor
   in the codebase (2,048 B). `buildVerdict` refused: the saver applied 0 times.
2. **Run 2 — instrument too coarse.** Repo-clone corpus (2,534 files): 241
   blocks, median 2,325 B, p90 15,261 B. Balanced eligible 11.2%; the saver
   applied. `buildVerdict` refused on the order check: baseline-first **1.598**
   vs megasaver-first **1.197** (tolerance 0.15). The ~0.40 gap is prompt-cache
   warming against an effect of ≤0.05 — **the instrument is ~8x too coarse.**
3. **Run 3 — budget died.** Per-arm-RUN cache namespacing was built to remove
   that warming asymmetry. The paid replay reached the API cleanly, then failed
   at request 16 of its second arm on `HTTP 400: credit balance too low`. 34 real
   requests went through. `S` was derived offline instead of measured.

### 1.1 The actual blocker is not budget — it is an unproven instrument

While calibrating the offline model, a defect was found that no test could see:
the arm-cache namespace marker rode on `system[0]`, a synthetic
`x-anthropic-billing-header` block whose `cch` value changes every request. The
recording's real `cache_read` of 945,296 proves the platform **strips that
block** — so the marker was being stripped with it and the four arm runs were
**not isolated at all**. The namespacing was inert while every test passed,
because the tests asserted that the four request bodies differ, which was true
in the harness and false at the API.

The marker now rides the block carrying the first `cache_control` (verified:
`system[2]` on the real recording) — that block *is* a breakpoint, so it is
provably inside the cached prefix and cannot be stripped. 4/4 mutations caught.

**But this fix has never been exercised against the live API.** Run 3 died
before it could show anything either way. So the central quantity `S` depends on
an isolation mechanism whose only evidence is reasoning plus offline mutation
tests — exactly the epistemic position that produced the inert-isolation bug in
the first place.

> **The lesson this spec is built around:** a test that checks what we *send*
> cannot see what the platform *does with it*. Only a signal derived from the
> API's own `usage` can prove isolation is live.

---

## 2. Goal & Non-Goals

**Goal.** Produce a verdict-capable instrument and read it: either an
**accepted** `ReplayVerdict` for `S` on the balanced corpus, or an **honest
refusal with a named, understood cause** — with the cache-isolation mechanism
**proven live at the API** either way.

Phase 0 exits on the instrument being trustworthy. A refused verdict from a
proven instrument closes this spec; an accepted verdict from an unproven one
does not.

**Non-goals.**

- Measuring behavioural effect (turn count). Fixed-trajectory replay cannot
  produce recovery turns or alternate agent paths — that is Stage B's problem.
- Aggressive mode. `.megasaver/policy.json` declares `{"modeFloor":"balanced"}`
  and `clampModeToFloor` refuses aggressive on this tree. **Relaxing the policy
  to obtain a number is forbidden** (§12: evidence-dropping compression stays
  banned on a HIGH-risk repo).
- Loosening `--order-tolerance` until a verdict appears, or averaging more runs
  to escape order sensitivity. Warming asymmetry is systematic bias; repeats
  shrink the standard error of a biased estimate, not the bias.
- Publishing any savings claim. See §7.
- Re-recording headers. `anthropic-beta` headers are still not recorded or
  replayed (bodies only — headers carry credentials and must not hit disk).
  This stays a documented KNOWN-UNVALIDATED, not a work item.

---

## 3. Design

### 3.1 Task A — Live cache-isolation probe (gates everything else)

A two-cell probe run against the live API **before** any full replay, derived
from the API's own `usage` rather than from what we send.

Replay the **single first request** of the recording (`k = 1`) five times, in two
cells with a trailing positive control (`posC`). `k = 1` is deliberate: a multi-request run warms its own cache internally,
so run B's later requests would read run B's own earlier entry and confound the
measurement. With one request per run there is no intra-run warming, and the only
possible source of a `cache_read` is another run.

The recording's system prefix alone is ~51 KB, far above the 1,024-token minimum
cacheable length, so one request is sufficient to create a cacheable entry.

Each cell uses its own namespaces so the cells cannot warm each other:

| cell | run A | run B | run C | isolation is LIVE ⇒ expect | isolation is INERT ⇒ expect |
|---|---|---|---|---|---|
| **POS** (sanity control) | `ns_P` | `ns_P` | `ns_P` | run B & C read run A's entry — `cache_read` large | same |
| **NEG** (isolation control) | `ns_N1` | `ns_N2` | N/A | both run A & B pay `cache_creation`; `cache_read ≈ 0` | run A or B reads run A's entry — `cache_read` large |

Run sequence: `POS.A -> POS.B -> NEG.A -> NEG.B -> POS.C`; assert on **run B & C of POS** and **max read of NEG**:

```
positiveControlWarmed = POS.runB.cache_read > 0
trailingControlWarmed = POS.runC.cache_read > 0
maxNegRead            = max(NEG.runA.cache_read, NEG.runB.cache_read)
negReadRatio          = maxNegRead / POS.runB.cache_read
isolationLive         = positiveControlWarmed && trailingControlWarmed && negReadRatio < 0.10
```

The POS cell is not optional: without it, a `cache_read ≈ 0` in NEG is
indistinguishable from "the cache did not warm at all" (wrong model id, prefix
below the floor, API-side change). POS proves the probe can observe a read
before NEG asserts the absence of one. `POS.C` (trailing positive control) guarantees
that the cache state was not lost to API-side eviction or node-routing changes mid-probe;
if `POS.C` misses, the probe refuses with `cache_state_lost`.


The probe is cheap — 4 short requests — and it is the **only** evidence that the
`system[2]` marker placement survives the platform. Task B does not start until
it passes.

**Failure handling.** If NEG shows a large `cache_read`, isolation is still
inert: stop, record the finding, and do **not** spend the corpus budget. The
`S` question stays open on a named cause, which is a legitimate outcome of this
spec (§2).

### 3.2 Task B — Budget rehearsal that refuses to start

Run 3 died mid-arm on credit exhaustion after 34 billed requests. `--dry-run`
and the billed-evidence printer already exist; what is missing is a **pre-flight
refusal**.

- Estimate the full four-arm-run cost from the recording itself: input tokens
  per request from the recorded bodies, `GENERATION_CAP_TOKENS` for output, the
  pinned `scripts/benchmark-rates.json` card.
- Compare against an operator-supplied `--budget-usd`. If
  `estimate × SAFETY_FACTOR > budget`, **refuse to start** with the numbers
  shown. `SAFETY_FACTOR = 1.3` (covers the model's known +38% cache-creation
  overestimate being wrong in the cheap direction, plus retry overhead).
- The estimate is printed whether or not it refuses, so the operator can fund
  the exact gap rather than guess.

This is not cost optimisation; it is refusing to convert budget into a
half-corpus that cannot produce a verdict.

### 3.3 Task C — Arm-run-boundary checkpointing (salvage without lying)

Run 3 lost 18 baseline + 16 megasaver billed requests. The receipts are now
printed (fixed), but the run must restart from zero and re-pay.

**Checkpoint at the arm-run boundary, never mid-arm.**

- After each of the four arm runs completes, persist its `ArmUsage` + integrity
  to a run journal keyed by `(recordingId, armRunIndex, namespace)`.
- On `--resume <journal>`, completed arm runs are reused verbatim; only
  unfinished ones are re-sent, each under a **fresh namespace**.
- A **partially sent** arm run is discarded for verdict purposes and its
  receipts retained for the evidence trail. It may never contribute to `S`.

Rationale: a mid-arm resume would splice two different cache-warming histories
into one cost object, silently manufacturing exactly the artefact the
namespacing exists to remove. Resume salvages *money already spent on complete
units*, never the integrity of the comparison.

### 3.4 Task D — The gate run

With A passed and B/C in place: `replayBothOrders` on `rec-big/task_1`, balanced
mode, four arm runs under four namespaces.

- **Accepted verdict** ⇒ `S` is measured. Record it beside the modelled 1.199x
  and report the delta as the model's calibration error (the model is not
  retro-fitted to the measurement; §3.5).
- **Refusal** ⇒ record which refusal fired (`order-sensitive`, `applied 0`,
  `byteRatio` integrity) and its numbers. A refusal after A passed is a
  *result*: it says the residual asymmetry is not the marker, and names the next
  candidate (interleaved arm ordering, pinned breakpoints, or a design that does
  not price two arms against a shared warming history).

### 3.5 What may not be touched

- `MAX_BYTE_RATIO = 0.95`, `MIN_DRIFT_SMOKE_TOLERANCE = 0.1`, the default
  `orderTolerance = 0.15`: constants, not knobs. Changing one to obtain a
  verdict is tuning the instrument to the answer.
- The offline cache model may **not** be recalibrated against this run's
  results. Its argument is the invariance checks (bytes-per-token 2.5–2.7 → S
  stable at 1.1989; ±50% creation error → S within 1.1987–1.1990), not fit. A
  model refitted to the measurement it is validating proves nothing.

---

## 4. Interfaces

```typescript
// packages/bench-replay/src/isolation-probe.ts
export interface IsolationProbeInput {
  recording: RecordedRequest[];
  send: Send;
  // k is fixed at 1: one request per run, so no intra-run warming can confound
  // the read attribution. The single request's prefix (~51 KB system) is far
  // above the 1,024-token cacheable minimum.
}

export interface IsolationProbeResult {
  posCell: { runA: RequestUsage; runB: RequestUsage };   // ns_P,  ns_P
  negCell: { runA: RequestUsage; runB: RequestUsage };   // ns_N1, ns_N2
  positiveControlWarmed: boolean;      // POS.runB.cache_read > 0 — probe can observe a read
  negReadRatio: number;                // NEG.runB.cache_read / POS.runB.cache_read
  isolationLive: boolean;              // positiveControlWarmed && negReadRatio < 0.10
  refusal?: string;                    // set when the probe cannot conclude
}

// packages/bench-replay/src/budget.ts
export interface BudgetEstimate {
  estimatedUsd: number;
  perArmRunUsd: number;
  safetyFactor: number;                // 1.3
  budgetUsd: number | undefined;
  wouldRefuse: boolean;
  breakdown: { inputTokens: number; cappedOutputTokens: number; requests: number };
}

// packages/bench-replay/src/run-journal.ts
export interface ArmRunJournalEntry {
  recordingId: string;
  armRunIndex: 0 | 1 | 2 | 3;
  namespace: string;
  status: "complete" | "partial";      // partial NEVER feeds a verdict
  usage: ArmUsage;
  integrity: ArmIntegrity;
}
```

`isolationLive === false` and `wouldRefuse === true` are both **hard stops**, not
warnings.

---

## 5. Test Plan (TDD — red first)

**Task A — isolation probe** (fake upstream, no API):
1. Inert-marker simulation: fake upstream that strips the block carrying the
   namespace marker ⇒ `isolationLive === false`. *This is the regression that
   the real bug would have failed.*
2. Live-marker simulation: fake upstream that honours the marker ⇒
   `isolationLive === true`.
3. Cold upstream (never warms): `positiveControlWarmed === false` ⇒ refusal, not
   a false `isolationLive: true` from a coincidental `cache_read ≈ 0`.
5. Cell contamination: NEG reusing `ns_P` ⇒ must be rejected, since NEG.runA
   would then read POS's entry and the cell measures nothing.
6. Mutation targets: marker back on `system[0]`; POS/NEG cells swapped; the
   `< 0.10` threshold inverted; `positiveControlWarmed` ignored; `k` raised
   above 1 (re-introduces intra-run warming).

**Task B — budget:** estimate matches a hand-computed fixture within 1%;
refuses when `estimate × 1.3 > budget`; prints the estimate on both paths;
missing `--budget-usd` does not silently disable the check.

**Task C — journal:** a partial arm run is excluded from `buildVerdict` input;
resume re-sends only unfinished runs; a resumed run gets a fresh namespace; a
journal from a different `recordingId` is refused.

**Task D — gate run:** operator-executed, not a unit test. Evidence captured:
probe output, budget estimate, four arm-run journals, the verdict or the refusal
with its numbers.

Every refusal path asserts on the **typed refusal**, not on message substrings
(child-spec #1 precedent: `TelemetryValidationError.code`).

---

## 6. Risks

| Risk | Handling |
|---|---|
| Probe passes but the full run still refuses on order | Legitimate outcome (§3.4). Names the next candidate; does not reopen the marker question. |
| Corpus is `rec-big` only — `R*` and `S` are corpus-specific | Stated in every artefact. A workload with many small compressed outputs and long sessions lowers `R*`. |
| Flat rate card, 17/18 opus-5 | `S` is **directional, not calibrated**. Haiku share is 0.32% of request bytes and carries no `tool_result`, so it cancels in the ratio. Restated wherever `S` appears. |
| Budget exhausts mid-run again | Task B refuses to start; Task C keeps completed arm runs. |
| API-side behaviour change between record and replay | Probe re-runs before each gate attempt; it is 4 requests. |

---

## 7. Claim Boundary (binding)

- A measured `S > 0` closes A4's open term **for this corpus, in balanced mode,
  on a flat rate card**. It is not a product savings claim.
- No public or marketing number may be derived from this run. Per v3 §17.7, a
  published figure requires the same corpus, the same L0 rates, two-order
  consistency, and a published methodology.
- `mega audit` / Pro surfaces are not wired to this output by this spec.
- If the probe fails, the honest statement remains: **`S` is modelled, not
  measured, and the isolation mechanism is unproven at the API.**

---

## 8. Definition of Done

1. This spec approved by the user; architect + critic passes in separate
   contexts (HIGH).
2. Plan in `docs/superpowers/plans/2026-08-01-bench-replay-real-gate-run-plan.md`.
3. TDD red→green for Tasks A–C, including the four Task-A mutations.
4. `pnpm verify` green.
5. Gate run executed; evidence archived (probe, budget estimate, journals,
   verdict-or-refusal with numbers).
6. `wiki/log.md` entry + `syntheses/variance-controlled-benchmark` updated with
   the outcome — including a negative one.
7. Zero pending TodoWrite items.
8. Changeset if the `@megasaver/bench-replay` public surface changed.
9. No savings claim published (§7).

---

## 9. Open Questions

- **Probe threshold:** `negReadRatio < 0.10` is chosen to be decisive rather
  than tight — live isolation should drive it to ~0, inert isolation to ~1. If a
  real run lands between 0.10 and 0.90, the mechanism is partially effective and
  neither conclusion holds; that outcome needs its own investigation rather than
  a threshold adjustment.
- **Interleaved ordering:** if the probe passes and order sensitivity persists,
  is per-request interleaving of the two arms within one warming history a
  sounder cost object than four isolated runs? Design work for a follow-up spec,
  not this one.
- **Corpus breadth:** one more corpus shape (long build logs, wide greps) would
  test whether `S` is stable across workload shapes. Out of scope here;
  candidate for child-spec #2b if `S` lands close to 1.00.
