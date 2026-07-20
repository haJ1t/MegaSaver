---
"@megasaver/stats": minor
---

Add `normalizedCostUsd`: benchmark cost derived from the token breakdown at
fixed standard rates, so identical token counts always price identically.
Rates live in `scripts/benchmark-rates.json`, shared with the bash/python
harness; a test pins the two in sync.

Scope note: this was introduced to remove a suspected fast-mode (2x) billing
artifact from the benchmark gate. Measurement of 24 saved benchmark result
files afterwards showed every one was served `standard` tier with
`fast_mode_state: off`, and raw `total_cost_usd` already equalled the
normalized value in all of them — so on current data this changes no number.
It is kept as insurance: the gate now cannot be perturbed by billing tier,
whatever tier a future run is served at.
