---
title: Cache-Write Cost Reduction — the 62–75% lever, attacked directly (2026-08-01)
tags: [cache, cost, proxy, turn-count, strategy, ideas]
sources:
  - docs/superpowers/specs/2026-07-19-net-positive-megasaver-design.md
  - syntheses/saver-cache-churn.md
  - syntheses/proxy-first-party-cache-parity.md
  - syntheses/rtk-competitive-analysis-2026-08-01.md
  - packages/connectors/claude-code/src/proxy-route.ts
  - syntheses/token-saver-root-cause-2026-07-28.md
status: active
created: 2026-08-01
updated: 2026-08-01
---

# Cache-Write Cost Reduction

User ask (2026-08-01): cache writes are 62–75% of measured baseline cost —
find ways to reduce THAT, as features to build. All items below are
**pre-spec ideas** (process-discipline: brainstorming → spec before code).

## 1. The math that ranks everything

Measured baseline cost decomposition ([[syntheses/saver-cache-churn]],
net-positive spec §Problem):

```
turn cost   ≈ read_last_breakpoint + write(new suffix)
session     ≈ Σ turns
write share = 62–75%   read share = 15–38%   output = 5–10%
```

Two implications:

1. **Turn count is a multiplier on BOTH reads and writes.** Halving turns
   halves the bill almost regardless of content. Nothing else has this
   property.
2. **Per-turn write cost = bytes in the new suffix.** System prompt, tools,
   CLAUDE.md are cached once; what we control is suffix stability (never
   re-write a cached turn) and suffix size (small deltas).

So the idea list splits into four attack lines: (A) cut turns, (B) never
churn the cached prefix, (C) shrink the per-turn suffix, (D) don't pay
write price for suffixes that are mostly re-reads.

## 2. Already spec'd / shipped — finish these first

| # | Idea | Status | Mechanism |
|---|---|---|---|
| 1 | First-sight-only saver (P1) | spec'd, net-positive Stage A | Never rewrite an already-seen `tool_result` → zero self-inflicted churn |
| 2 | Turn-cutter warm start (P2) | spec'd, Stage B | Byte-stable context pack at UserPromptSubmit → fewer blind exploration turns (benchmarks already showed 7 vs 11 turns) |
| 3 | PreToolUse command-rewrite saver | idea in [[syntheses/rtk-competitive-analysis-2026-08-01]] #2 | Compressed output is the ONLY version that ever exists → no churn by construction (RTK's mechanism, our losslessness) |
| 4 | First-party route + flag | SHIPPED ([[syntheses/proxy-first-party-cache-parity]], 1.30x) | Custom base-URL cache tax removed |

These four are the floor. Everything below is NEW.

## 3. New attack ideas

### A. Turn-count killers (biggest lever, multiplier on everything)

**A1. Exploration-freeze pack (extends P2).** The warm-start pack already
cuts turns. Add a "don't re-read" manifest to it: paths the pack already
summarized + their content hashes. Hook-side: a Read of a file whose hash
is unchanged since the pack returns the pack's summary + a delta hint
instead of the full body. Mechanism: kills the most common repeat turn
(read file → think → read same file again). Risk: HIGH (answer-correctness
on stale summaries → gate on code-truth verify).

**A2. Turn-budget governor.** Daemon tracks turns-per-task from the intent
hook; when a session's turn count crosses 1.5× the trailing median for
similar tasks, inject ONE systemMessage suggesting consolidation ("you have
N open questions — batch them"). Advisory, never blocking. Mechanism: the
long tail of a session is dithering; a nudge at the right moment cuts it.
JetBrains measured rtk's tax as +13.8% turns — turns are where tools win
and lose.

**A3. Batch-read advisor.** Detect Read/Grep call patterns (same directory,
sequential files) and suggest one `mega output exec rg …` call returning
ranked excerpts instead of 5 individual Reads. Fewer round-trips = fewer
full-prefix writes.

### B. Churn eliminators (protect the cached prefix)

**B4. Cache-boundary awareness via the proxy (the "correct" fix from the
superseded cache-aware spec §1).** Our proxy sees the outgoing request body
— it KNOWS where `cache_control` breakpoints are. Feed breakpoint position
back to the saver (one line in the usage ledger): the saver then refuses to
rewrite any tool_result BEFORE the last breakpoint, full stop. This is
strictly better than first-sight heuristics because it is exact. Unlocks:
safe re-compression of the live suffix only.

**B5. Suffix-stability linter (`mega doctor --cache`).** Static analysis of
everything that lands in the suffix: hook stacks that rewrite in place,
`additionalContext` emitters with nondeterministic output, CLAUDE.md blocks
that change per session (timestamps, session ids — our own connector block
must pass this). Report each with its measured cache_creation contribution
from the usage ledger. Nobody sells this; every heavy Claude Code user has
2–5% hidden churn from hook stacks.

**B6. Deterministic connector block.** Audit our own injected
`MEGA SAVER:CONTEXT_GATE` block for byte-stability across sessions (same
input → same bytes, no dates/ids). Cheap, dogfood, prerequisite for B5
credibility.

### C. Suffix shrinkers (smaller writes per turn)

**C7. Tool-schema diet at the proxy (tool-router made real).** Proxy strips
unused MCP tool schemas from the request `tools` array on turns where the
task can't need them (Phase 7 advisor logic, moved from advisory to
request-shaping). Schemas are re-written on every cache-miss turn; 35 MCP
tools × full JSON schemas is real bytes. Requires: per-turn classification
+ prove parity on benchmark. HIGH risk, proxy request-shaping (same class
as P3 — gated).

**C8. System-reminder compressor.** Claude Code injects system-reminders
(context left, file-changed notices) into the suffix; some are verbose.
Proxy-side rewrite of reminder boilerplate to a compact form the model
still parses. Small per-turn win, multiplies over a session. Same gating
as C7.

### D. Re-read pricing exploit (the structural one)

**D9. First-party route for EVERYONE (distribution play).** Our parity fix
(shipped, 1.30x measured) works because an internal client flag restores
first-party cache behavior over a custom base URL
(`proxy-route.ts:24-31`). Productize it harder: "run your agent through
mega proxy, pay read prices on your re-reads." This is not compression —
it is moving the same bytes from the 1.25x write bucket to the 0.1x read
bucket. For heavy users this dwarfs any saver. Package as the DEFAULT
install path, not an opt-in. Honesty constraint: only valid while the flag
holds; monitor per release (`proxy-route.ts` already gates honesty on
default upstream).

**D10. Cache-keep-alive scheduler (was P6-adjacent, out-of-scope in
net-positive spec — revisit).** 5-minute cache TTL expiry turns a read
into a full write. For interactive users, a background daemon tick that
issues a minimal cache-refresh request before TTL expiry keeps the prefix
at read prices through idle gaps (meetings, thinking). Costs one tiny
write to save one huge one. Needs honest math first: refresh cost vs
expiry probability × suffix size; measure on real usage-ledger data.

## 4. Ranking

| rank | idea | expected ceiling | effort | risk |
|---|---|---|---|---|
| 1 | #2/#3 turn-cutter + rewrite saver (finish spec'd work) | turns −30–50% | M | HIGH |
| 2 | B4 cache-boundary awareness | kills residual churn exactly | M | MEDIUM |
| 3 | D9 first-party for everyone | write→read repricing, 1.3x+ proven | S | shipped core |
| 4 | B5 suffix-stability linter | finds other people's churn | S | LOW |
| 5 | A1 exploration-freeze pack | turns −10–20% more | M | HIGH |
| 6 | D10 keep-alive | workload-dependent | M | MEDIUM (billing ethics check) |
| 7 | C7 tool-schema diet | per-turn suffix −5–15% | L | HIGH (request shaping) |
| 8 | A2/A3 advisors | thin but real | S | LOW |

Strategic note: RTK (and every compression-only tool) cannot touch ANY of
these — they have no proxy, no usage ledger, no repo index, no memory.
This list IS the moat. ([[syntheses/rtk-competitive-analysis-2026-08-01]] §6)

