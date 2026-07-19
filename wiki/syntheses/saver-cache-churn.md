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

## Direction

Make the saver **cache-aware** — compress only what the client won't cache cheaply,
never rewrite an already-cached prefix. Spec:
`docs/superpowers/specs/2026-07-19-cache-aware-saver-design.md`.
