# Cache-Aware Saver — Design

- **Date:** 2026-07-19
- **Risk:** HIGH (saver core path; evidence-preserving compression; touches every
  PostToolUse). Per risk-modes.md: full chain + architect + critic + worktree.
- **Status:** SUPERSEDED 2026-07-19 by
  `2026-07-19-net-positive-megasaver-design.md` (brainstormed + user-approved).
  The first-sight-only direction proposed here was adopted as its Stage A/P1;
  the wider staged composition (ledger guardrail, turn-cutter warm start,
  gated model cascade) lives there. Kept for the evidence trail.

## Problem (proven)

The PostToolUse saver rewrites `tool_result` in place via `updatedToolOutput`. That
mutation changes the conversation prefix, so Claude Code's native 1h prompt cache
misses on the next turn and re-creates the whole prefix at $10/Mtok (2x under fast
mode). On short, cache-friendly workloads the churn tax >= the compression benefit.

Benchmark (mega 2.2.0 + first-party fix, geomean cost, baseline ÷ megasaver):
balanced **0.96x**, aggressive **0.93x** — no net win, aggressive worse. Composition
proof (aggressive task_1): megasaver cache_creation 48,005 vs baseline 29,525. Full
evidence: `wiki/syntheses/saver-cache-churn.md`.

The saver optimizes a cost the client already solved (cheap cache-reads of repeated
tool output) and pays cache-creation to do it.

## Goal

The saver must never make a session cost MORE than baseline. Target: net cost ≤
baseline on cache-friendly workloads (the current failing case), while keeping the
real win on large one-shot tool output.

Success metric: re-run `scripts/run-megasaver-claude-limit-test.sh` (both modes) →
cost geomean ≥ 1.00x, and no single task below ~0.95x outside fast-mode noise.

## Candidate approaches (to be judged at brainstorming)

1. **Cache-boundary-respecting compression.** Only compress a tool_result that sits
   AFTER the last `cache_control` breakpoint (i.e. not yet in the stable cached
   prefix). Once a turn has been cached, never rewrite it. Requires the saver to
   know / infer the client's breakpoint placement — hard, since the hook sees the
   tool result, not the outgoing request. May need the proxy to feed breakpoint
   info back, coupling two subsystems.

2. **First-sight-only compression.** Compress a tool_result the first time it is
   produced (before it can be cached), never on re-emission. Simple heuristic:
   track a content hash per session; compress only unseen hashes. Avoids rewriting
   anything the client already cached. Cheap, hook-local, no proxy coupling.
   Closest to the observed win (novel bulk) while dropping the observed loss
   (re-reads).

3. **Size/recurrence gate.** Only compress outputs above a byte threshold AND
   predicted non-recurring (e.g. one-shot log dumps, wide greps). Leave small or
   likely-cached outputs untouched. Tunable; risks under-compressing.

4. **Measure-then-compress (self-governing).** The saver reads the proxy's own
   usage ledger; if the megasaver session's cache-creation is trending above a
   baseline estimate, it backs off. Closes the loop but heavy and slow to react.

Leaning: **(2) first-sight-only** as the v1 — smallest change, hook-local, directly
targets the proven churn (re-writing already-cached content). (1) is the "correct"
long-term fix but needs proxy↔hook coupling that doesn't exist yet.

## Non-goals

- Not changing the proxy's byte-verbatim forwarding.
- Not touching the first-party flag path (that fix is shipped and robust).
- Not a compression-algorithm change — the issue is WHEN to rewrite, not HOW.

## Open questions (for brainstorming)

- Can the hook cheaply know whether a given tool_result will land before or after a
  cache breakpoint? If not, is a content-hash "seen before" proxy good enough?
- Does the win on large one-shot output survive once we stop rewriting re-reads, or
  does first-sight compression also churn the cache for THAT turn (the compressed
  form differs from what the client would cache)? Needs a targeted measurement:
  one big-output task, first-sight compress, measure cache_creation delta.
- Should aggressive mode be removed/renamed if "more compression" is strictly worse?

## Definition of done

- Brainstorm → approach chosen → this spec updated to a single design.
- Plan in `docs/superpowers/plans/`.
- TDD: a saver-decision test that asserts no rewrite of an already-seen/cached
  tool_result.
- Benchmark rerun (both modes) shows cost geomean ≥ 1.00x with a captured table.
- code-reviewer AND critic (HIGH risk, separate contexts).
