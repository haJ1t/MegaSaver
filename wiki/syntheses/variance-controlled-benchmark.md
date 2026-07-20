---
title: Variance-Controlled Benchmark Harness (L0 + L1)
type: synthesis
created: 2026-07-20
sources:
  - docs/superpowers/specs/2026-07-19-variance-controlled-benchmark-design.md
  - docs/superpowers/plans/2026-07-19-variance-controlled-benchmark-plan.md
  - branch feat/bench-replay (14 commits)
  - direct inspection of 24 saved Stage A result.json files
  - code-reviewer + critic passes, 2026-07-20
---

# Variance-Controlled Benchmark Harness

## Claim

MegaSaver's benchmark could not resolve the ~5% effect it was built to judge.
`feat/bench-replay` replaces the measurement with a record/replay harness that
removes the variance by construction, and — as importantly — that refuses to
emit a verdict it cannot vouch for.

## What the variance actually was

See [[syntheses/saver-cache-churn]] §CORRECTION. Short version: **not**
fast-mode billing (that hypothesis was checked and falsified — all 24 saved
results are standard-tier, `fast_mode_state: off`, raw ÷ normalized = 1.000).
The two real sources are agent turn count driving cache_read near-linearly, and
the saver's own per-workspace store carrying over between runs and silently
switching the saver off.

## Design

- **L0** — cost from the token breakdown at fixed rates
  (`scripts/benchmark-rates.json`, shared by TS and the bash harness, pinned in
  sync by a test). Changes no number on current data; kept as insurance.
- **L1** — a capture proxy records one conversation's `/v1/messages` bodies
  byte-verbatim; both arms replay that frozen sequence, differing only by the
  saver's transform. No agent runs, so turn count cannot vary.

## Four defects review caught that would have produced confident wrong numbers

1. **Saver applied per request instead of per tool call.** A Messages API
   conversation resends its whole history each turn, so a stateless
   per-request transform re-invoked the saver on the same `tool_result` once
   per containing request. Production fires the hook **once** per tool call and
   the compressed text then sits in the transcript verbatim. The bug made the
   megasaver arm's prefix mutate every turn, paying `cache_creation` ($10/Mtok)
   where baseline paid `cache_read` ($0.50/Mtok) — a ~20x penalty manufactured
   by the harness, which would have condemned the very feature built to stop
   prefix churn. Fixed: apply once per distinct `tool_use_id`, memoize.
2. **An isolated store disables the saver.** A fresh `XDG_DATA_HOME` has no
   saver settings, so the hook resolves `disabled — source missing` and passes
   everything through. Measured: fresh store → passthrough; after
   `session saver default enable` → 100,000 B → 12,222 B. The megasaver arm
   would have been byte-identical to baseline, reporting a clean `1.00x`.
   Fixed: seed and verify the store; count `applied`/`passthrough`/`failed`;
   refuse a verdict when nothing was applied or nothing shrank.
3. **Arm order contaminates via the prompt cache.** Both arms share a
   byte-identical system+tools prefix. Running baseline first makes it pay
   `cache_creation` while megasaver, minutes later, reads the same bytes at
   `cache_read` — biasing in MegaSaver's favour by an unrecorded wall-clock
   gap. Fixed: run both orders, refuse a verdict if they disagree.
4. **Array-form `tool_result` silently skipped.** 14.4% of 17,584 real
   `tool_result` blocks sampled from local Claude Code history use array
   content, not string. The original predicate matched strings only, so ~1 in 7
   blocks passed through untransformed — biasing toward "no effect".

## What the harness can and cannot claim

- **Can:** resolve the saver's direct token/cache effect on a fixed
  conversation, deterministically, and detect its own order-sensitivity,
  inert-arm, and pre-compressed-recording failure modes.
- **Cannot:** measure the saver's effect on agent *behaviour* (fewer or more
  turns because compressed output read differently). That is Stage B's target
  and needs high-N end-to-end, not replay.
- **Cannot:** calibrate to better than its drift tolerance. `calibrationOk` was
  renamed `baselineDriftSmokeOk` and enforces a **0.10 tolerance floor** — it
  rejects callers asking for precision it cannot deliver, rather than returning
  a reassuring `true`. The runner feeds it a same-conversation reference (the
  recording run's own `--output-format json` usage), which is the only genuine
  reference available.

## Status

Built and green offline: 101 package tests, runner proven end to end against a
fake upstream. **The real gate has not been run** — it needs an
`ANTHROPIC_API_KEY` for the replay sender (Claude Code's own OAuth is not
usable by a separate HTTP client). No Stage A verdict exists yet; the parked
`feat/net-positive-stage-a` branch remains unmerged and ungated.

Known-unproven until a real run: `anthropic-beta` headers are not recorded or
replayed (bodies only — headers carry credentials and must not hit disk), so
the API may respond differently or reject; and the order/drift tolerances
(0.15 / 0.25) are untested guesses against a real prompt cache.
