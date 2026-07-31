# Bench-Replay Real Gate Runbook

## 1. Pre-flight (unpaid)
Record or reuse `rec-big/task_1`. Run `estimateGateRunBudget` and print it. If `wouldRefuse` — stop and fund the printed gap.

## 2. Probe (paid, 4 short requests)
Run `runIsolationProbe`. Record `posCell`, `negCell`, `negReadRatio`, `isolationLive`.
- `refusal: "positive_control_never_warmed"` ⇒ the probe cannot see reads. Stop; investigate model id / prefix length / API change. **Do not** proceed.
- `isolationLive === false` ⇒ isolation is still inert. Stop, record the finding, leave `S` open on a named cause. **This is a legitimate outcome of the spec.**
- `negReadRatio` between 0.10 and 0.90 ⇒ partially effective. Stop and investigate. **Do not** adjust the ceiling.

## 3. Gate run (paid)
`replayBothOrders` on `rec-big/task_1`, balanced, four arm runs. Journal each completed arm run.

## 4. Outcome
Accepted verdict ⇒ record measured `S` beside the modelled `1.199x`; report the delta as the model's calibration error and **do not** refit the model. Refusal ⇒ record which refusal fired with its numbers.

## 5. Evidence checklist
probe output · budget estimate · four journal entries · verdict-or-refusal · the constants used (0.95 / 0.1 / 0.15 / 1.3) shown unchanged.

## 6. Claim boundary
Restate: `S` is corpus-specific, balanced-only, priced on a flat rate card (17/18 opus-5), and **no savings claim may be published**.
