# Variance-Controlled Benchmark Harness (L0 + L1) — Design

- **Date:** 2026-07-19
- **Risk:** MEDIUM (measurement tooling; no product code path. The gate it feeds
  is HIGH-stakes — a wrong harness green-lights a regression — so calibration is
  a hard requirement, not a nicety.)
- **Status:** user-approved design (layering + real-API-first decisions locked
  2026-07-19). Blocks the Stage A gate re-run and every later stage.

## Problem (measured)

The current harness cannot resolve the effects it is asked to judge. Stage A was
implemented, fully reviewed, `pnpm verify` green — then measured across 2 full
runs (8 task-pairs) and the gate FAILED with numbers that are mostly noise:

| task | run 1 | run 2 | ms turns | bl turns |
|---|---:|---:|---|---|
| task_1 | 0.70x | 1.03x | 5 / 5 | 5 / 5 |
| task_2 | 1.15x | 0.88x | 11, 13 | 14, 13 |
| task_3 | 1.23x | 1.07x | 12, 18 | 14, 18 |
| task_4 | 1.02x | 0.68x | 10, 11 | 10, 6 |

geomean 0.948x, min 0.68x, pooled 0.971x — against a pre-Stage-A 0.96x, i.e.
**indistinguishable**. Two dominant variance sources, both larger than the ~5%
effect under test:

1. **Fast-mode 2x billing.** `total_cost_usd` mixes 1x- and 2x-served requests.
   task_1 flipped 0.70x → 1.03x across runs on near-identical token counts —
   a pure billing artifact, not a code difference.
2. **Agent path nondeterminism.** Same prompt, different exploration: task_4
   baseline took 10 turns in run 1 and 6 in run 2; task_2 megasaver input swung
   384k → 591k. Turn count dominates cost, and it is random.

Spread 0.68x–1.23x (1.8×). Consequence: **no stage can be validated**, including
Stage B's turn-cutter, whose target metric (turn count) is exactly what swings.

## Goal

A harness that resolves a ≤5% cost effect deterministically, cheaply enough to
run on every change. Success: replaying the same recorded conversation through
both arms twice yields the same verdict to within ±1%.

## Scope — layers, and what this spec covers

| | Layer | This spec |
|---|---|---|
| **L0** | Token-derived cost normalization | **YES** |
| **L1** | Real-API replay gate (deterministic) | **YES** |
| L2 | Offline cache simulator, calibrated from L1 output | **deferred** — cannot be written before L1 produces calibration data |
| L3 | High-N end-to-end with confidence intervals | **deferred** — for the commercial claim, not per-change gating |

L2/L3 get their own specs. Deferring them is deliberate: L1 must exist and be
calibrated first, or the simulator has nothing truthful to be checked against.

## L0 — cost normalization

Stop gating on `total_cost_usd`. Compute cost from the token breakdown at fixed
standard rates (the rates already derived and verified against 11 result files
on 2026-07-14):

```
cost = plain×$5 + cache_creation×$10 + cache_read×$0.50 + output×$25   per Mtok
```

This removes the fast-mode artifact outright — identical tokens now always yield
identical cost. Raw `total_cost_usd` is still reported alongside, for
transparency and to keep the fast-mode discrepancy visible rather than hidden.

A pure `normalizedCostUsd(usage)` function; every layer (including the existing
end-to-end script, which gains it for free) gates on it.

## L1 — record → replay

**Record (once per task).** A capture proxy sits between Claude Code and the API
and writes every `/v1/messages` request body verbatim to disk. One agentic run
per task produces that task's canonical request sequence — a frozen conversation
(a working prototype of this proxy was built and used during the 2026-07-14
forensics, so the mechanism is proven).

**Replay (once per arm).** Send the recorded sequence to the real API. The only
difference between arms is the transform applied to each `tool_result` block:

- baseline: content exactly as recorded;
- megasaver: content replaced by the saver's own decision output
  (`buildSaverDecision`), so the arm under test is the real product code, not a
  reimplementation.

No agent runs; assistant turns are replayed from the recording. The API returns
**real** `cache_creation` / `cache_read` / `input` / `output` counts.

**Why this is deterministic.** Both arms see the same conversation: same turn
count, same tool sequence, same ordering. Every path-variance source from the
problem statement is eliminated by construction, leaving only the saver's direct
token/cache effect. Resolution goes from ~5% to <1%.

**What it deliberately does NOT measure.** Any effect the saver has on agent
*behavior* — fewer or more turns because the compressed output read differently.
That is precisely Stage B's (P2 turn-cutter) target and belongs to L3. This
limit must be stated in the harness's own output, so an L1 pass is never
mistaken for end-to-end proof.

## Gate

- Gate on the **normalized** cost ratio, not the raw one.
- Report per-task and pooled, always with the `cache_creation` / `cache_read` /
  `plain` / `output` breakdown, so a regression shows *where* it came from.
- Because the measurement is deterministic, one replay per arm suffices —
  but the harness asserts that determinism: a repeat replay must reproduce the
  verdict within ±1%, otherwise it reports the run as unstable and refuses a
  verdict.
- **Calibration guard (hard requirement).** L1's baseline numbers must land
  within a stated tolerance of the same task's real end-to-end baseline (data we
  already have from the Stage A runs). Outside tolerance, the harness declares
  itself uncalibrated and the gate is void rather than green. A measurement tool
  that silently drifts is worse than none.

## Testing

- `normalizedCostUsd`: pure, table-driven. A fast-mode-billed usage object and a
  standard-tier one with identical tokens must produce the identical normalized
  cost (the exact artifact that broke the old gate).
- Replay engine: fixture request-sequence in, transformed sequence out — assert
  the emitted body carries the transformed `tool_result`, and that message order,
  roles, and every non-`tool_result` field survive untouched.
- Determinism: replaying the same fixture twice produces byte-identical request
  bodies.
- No network in unit tests; the API call is injected.

## Definition of done

`pnpm verify` green; L0 wired into the existing end-to-end script; L1 records and
replays all 4 benchmark tasks with a calibration check passing; Stage A re-gated
through L1 with the result recorded honestly in
`wiki/syntheses/saver-cache-churn.md` — including if it fails again.

## Constraints / risks

- Replay costs real tokens (~$2-5 per gate: input-billed requests, no agent
  turns). Far below the end-to-end harness's $50-100, but not free — hence L2.
- The recorded conversation ages: if Claude Code changes its request shape, the
  recording must be refreshed. The calibration guard is what detects this.
- Replaying a conversation whose assistant turns were produced under the *other*
  arm's content is an approximation — acceptable, because both arms replay the
  SAME recording, so the comparison stays fair; it is only the absolute numbers
  that are approximate, and the gate reads a ratio.
