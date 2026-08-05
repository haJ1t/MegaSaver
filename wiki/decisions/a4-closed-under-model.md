---
title: A4 closes under model — no paid replay is planned
tags: [decision, benchmark, bench-replay, a4, cost, locked]
sources:
  - packages/bench-replay/src/cache-model.ts:113
  - docs/superpowers/specs/2026-08-01-bench-replay-real-gate-run-design.md
  - syntheses/variance-controlled-benchmark.md
  - syntheses/saver-cache-churn.md
  - wiki/log.md 2026-07-30 (A4 reformulation, offline S derivation)
status: locked
created: 2026-08-03
updated: 2026-08-03
---

# A4 closes under model

**Locked (user directive 2026-08-03: no API budget will be available).** A4 —
`S > 0` and `R < R*` — is closed with `S` **modelled**, not live-measured. No
paid replay is planned. Child-spec #2's instrument stays built and unused.

| term | value | basis |
|---|---|---|
| `R*` break-even recovery rate | 66.7% | derived offline, 8/8 mutations caught |
| `R` observed recovery rate | 2.4% | production ledger, 46 rows — ~28x margin |
| `S` input-side saving | 1.199x | offline cache model, validated (below) |

## Why the model does not need the paid run to be valid

`simulateCacheCost` allocates a fresh prefix map per call
(`cache-model.ts:113`), so it shares no state between arms. **Arm-order
contamination and the whole cache-isolation problem are live-replay artifacts
that cannot reach it.** The per-arm-RUN namespacing, the `system[2]` marker
placement and child-spec #2's isolation probe all existed to make a *paid*
two-arm replay trustworthy; none of them is load-bearing for the model.

The model's own validation was already bought with data that had been paid for:

- total input-side tokens within **0.1%** of the recording's real end-to-end
  figures (1,024,470 vs 1,025,568)
- invariant to its one free parameter: bytes-per-token 2.5–2.7 → S = 1.1989
  throughout
- invariant to its known errors: creation ±50%, read −20% → S stays
  1.1987–1.1990
- agrees with the one fair real measurement available — the order-sensitive
  run's warm second pair measured **1.197** against the model's **1.199**

## Why a paid run would not have fixed the real weakness

`S`'s genuine fragility is that it is **corpus-specific**. One more paid run
produces one more number on one more corpus; it cannot show that `S` is stable
across workload shapes. Running the model over several corpora can, and costs
nothing. Depth was the expensive answer to the wrong question.

## What this changes

- A4 is **closed under model**, not "pending a run". Leaving it pending
  described a future that will not happen.
- `S` is reported as a **range across corpora**, never as one number, once more
  corpora are modelled.
- Every surface carrying `S` keeps its standing qualifiers: balanced mode only,
  flat rate card (17/18 opus-5), directional rather than calibrated.
- Child-spec #2's probe, budget estimator and run journal remain in
  `@megasaver/bench-replay`, tested and unused. Its runbook is marked
  **not scheduled**, not deleted — if budget ever appears the gate is ready.
- **No savings claim is published from `S`.** It is an internal engineering
  gate. The customer-facing number is measured tokens with an estimated dollar
  figure ([[sources/quantum-context-engine-v2]] child-spec #3).

## Related

- [[syntheses/variance-controlled-benchmark]] — the harness and its four defects
- [[syntheses/saver-cache-churn]] — the retracted churn mechanism; `S` is what
  replaced the question it was asking
