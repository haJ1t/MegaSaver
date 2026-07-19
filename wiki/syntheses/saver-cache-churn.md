---
title: Saver Cache-Churn — Compression Fights Native Prompt Caching
type: synthesis
created: 2026-07-19
sources:
  - benchmark runs 2026-07-18/19 (scripts/run-megasaver-claude-limit-test.sh, real claude -p usage tokens)
  - request-body + usage.jsonl forensics 2026-07-14 (7-agent workflow)
  - wiki/syntheses/proxy-first-party-cache-parity
---

# Saver Cache-Churn

## Claim

On short, cache-friendly coding tasks, MegaSaver's PostToolUse saver does **not**
reduce billable tokens — it lands at parity-to-slightly-worse. Root cause: the
saver **rewrites `tool_result` in place** (`updatedToolOutput`), which mutates the
conversation prefix and invalidates Claude Code's native 1h prompt cache. The
re-created cache is billed at the priciest rate ($10/Mtok, 2x under fast mode),
and that churn cancels the compression benefit. More compression → more churn →
worse.

## Evidence — benchmark (4 tasks × 2 arms, mega 2.2.0 + first-party fix)

Geometric mean, baseline ÷ megasaver (>1.00 = MegaSaver cheaper):

| mode | cost | billable input |
|---|---:|---:|
| balanced | **0.96x** | 1.05x |
| aggressive | **0.93x** | 0.98x |

Neither mode beats baseline. Aggressive is *worse* than balanced — the opposite of
the "less tokens" promise.

Mechanism, aggressive task_1 (cold cache), `.usage` composition:

| arm | cache_creation | note |
|---|---:|---|
| megasaver | 48,005 | saver rewrote tool_result → prefix diverged → re-created cache |
| baseline | 29,525 | no rewrite → prefix intact → cache reused |

The ~18k extra cache-creation is the churn tax. It recurs whenever the saver fires
on a turn whose output the client would otherwise have cached.

## What is robust

- **First-party flag fix works** (see [[syntheses/proxy-first-party-cache-parity]]):
  uncached "plain" input in the megasaver arm is ≤15 tokens (was 20,366). The 2.6x
  proxy disaster is permanently gone; both modes sit near parity *because* of it,
  not the saver.
- Where the saver *does* help (e.g. task_2 aggressive, 1.13x/1.39x): long, novel
  tool output that the client had NOT yet cached — compressing first-sight bulk
  before it enters history is a real win. The loss is concentrated on re-reads of
  already-cached content.

## The tension

MegaSaver's core premise ("less tokens, same signal") assumes the tokens it strips
were going to be re-sent at full price. With Claude Code's own prompt caching, most
repeated tool output is already near-free on re-read ($0.50/Mtok). Rewriting it to
compress converts a cheap cache-read into an expensive cache-write. The product is
optimizing a cost the client already solved, and paying to do so.

## Caveats

- n=1 per cell; high run-to-run variance (fast-mode 2x billing, cache-warming
  order). task_1's 0.67–0.69x is partly a cold-cache artifact. Direction (no net
  win) is consistent across both runs and both modes; exact magnitudes are not.
- Benchmark = short tasks on a tiny repo. A workload with large, one-shot,
  non-recurring tool output (big log dumps, wide greps read once) would favor the
  saver more. Not yet measured.

## Stage A results (2026-07-19) — gate FAILED, and the harness is now the blocker

Stage A (P0 ledger guardrail + P1 first-sight-only saver) was implemented,
fully reviewed, and `pnpm verify` green (54/54). It was then measured with the
Stage A build deployed globally, balanced mode, 2 full runs (8 task-pairs):

| task | run 1 | run 2 | ms turns | bl turns |
|---|---:|---:|---|---|
| task_1 | 0.70x | 1.03x | 5 / 5 | 5 / 5 |
| task_2 | 1.15x | 0.88x | 11, 13 | 14, 13 |
| task_3 | 1.23x | 1.07x | 12, 18 | 14, 18 |
| task_4 | 1.02x | 0.68x | 10, 11 | 10, 6 |

- geomean of 8 ratios **0.948x** (gate wanted ≥1.0x) → **FAIL**
- min task **0.68x** (gate wanted ≥0.9x) → **FAIL**
- pooled total cost **0.971x** ($5.06 megasaver vs $4.92 baseline)

**Stage A produced no measurable improvement.** Pre-Stage-A balanced was 0.96x;
Stage A pooled is 0.97x — indistinguishable. The honest claim is "no measured
effect", not "it worked".

### The real finding: benchmark variance now exceeds the effect

- Same task, same code: task_1 run1 **0.70x** → run2 **1.03x**.
- Agent path is nondeterministic: task_4 baseline took **10 turns** in run 1 and
  **6** in run 2; task_2 megasaver input swung **384k → 591k** for the same prompt.
- Spread **0.68x–1.23x (1.8×)** against a ~5% effect.

### CORRECTION (2026-07-20): the fast-mode billing hypothesis was WRONG

The original text above attributed task_1's 0.70x → 1.03x swing to a fast-mode
2x billing artifact. **That is false and is retracted.** All 24 saved result
files across both Stage A runs were checked directly:

| field | value in all 24 files |
|---|---|
| `fast_mode_state` | `off` |
| `usage.service_tier` | `standard` |
| raw `total_cost_usd` ÷ normalized cost | **1.000** (0% deviation) |

No 1x/2x mixing exists in this data. Cost normalization (L0) therefore changes
no number here; it is kept only as insurance against a tier the benchmark has
not yet been served at.

The two variance sources that are real:

1. **Turn count → cache_read, near-linearly.** task_4 baseline 10 turns /
   402k cache_read → 6 turns / 203k. task_3 megasaver 12 turns / 507k →
   18 turns / 776k. This was correctly identified originally.
2. **Saver state carry-over between runs (NOT previously identified).**
   task_1 ran **5/5 turns in both runs** — no path variance at all — yet
   megasaver `cache_creation` went **48,681 → 29,613**, landing on baseline's
   30,129. The saver compressed in run 1 and did essentially nothing in run 2.
   Its per-workspace store (first-sight hash ledger + net-effect auto-pause
   verdict) survived between runs.

Consequence: **task_1's "1.03x pass" in run 2 was Stage A switching itself off,
not Stage A working.** Any harness that reuses a saver store across runs
measures the saver's decay, not its effect.

Consequence: **no stage can be validated with this harness** — including Stage B
(P2 turn-cutter), whose target metric (turn count) is exactly what swings randomly.
Fixing measurement is the critical path before further optimization.

Cheapest known fixes: compute cost from the token breakdown at fixed standard
rates (kills the fast-mode artifact outright, pure arithmetic, zero extra runs);
and control agent-path nondeterminism (replay a fixed tool-call transcript through
both arms, or raise N with normalized cost).

Stage A branch `feat/net-positive-stage-a` (11 commits) is parked unmerged
pending a harness that can resolve the effect.

## Direction

Make the saver **cache-aware** — compress only what the client won't cache cheaply,
never rewrite an already-cached prefix. Spec:
`docs/superpowers/specs/2026-07-19-cache-aware-saver-design.md`.
