# Net-Positive MegaSaver (P0+P1 → P2 → gated P3) — Design

- **Date:** 2026-07-19
- **Risk:** HIGH (saver core path, hook injection, stats semantics). Stage C (P3)
  is CRITICAL (proxy rewrites request bodies) and is design-locked behind its own
  user-approval gate — see §Stage C.
- **Status:** user-approved design (composition + staging locked 2026-07-19:
  "kademeli tam paket: P0+P1 → P2 → gerekirse P3"). Supersedes and absorbs
  `2026-07-19-cache-aware-saver-design.md` (its P1 direction is Stage A here).

## Problem (proven)

Two benchmark rounds (mega 2.2.0 + first-party proxy fix, 4 real `claude -p`
coding tasks × 2 arms, tokens from `--output-format json`):

| saver mode | cost geomean (baseline ÷ megasaver) | input geomean |
|---|---:|---:|
| balanced | 0.96x | 1.05x |
| aggressive | 0.93x | 0.98x |

No net win; more compression is worse. Root cause proven via `.usage`
composition (aggressive task_1: megasaver cache_creation 48,005 vs baseline
29,525): the PostToolUse saver rewrites `tool_result` in place, invalidating
Claude Code's native 1h prompt cache; churn (writes at $10/Mtok) cancels the
compression benefit. Full evidence: `wiki/syntheses/saver-cache-churn.md`.

Deeper: measured baseline cost decomposes as **cache writes 62-75%, cache reads
15-38%, output 5-10%**. Tool output is a small slice of the writes; a perfect,
churn-free saver therefore has a hard ceiling of ~1.1-1.25x. The 2x target
lives in **turn count** (multiplier on reads AND append-writes) and **model
price per turn** — not in compression ratio.

## Goal & gates

Balanced mode must cut real session cost to **≤0.5x baseline** (geomean cost
savings ≥2.0x) on the benchmark workload, staged with hard measurement gates:

| stage | ships | gate (benchmark, balanced, 2 repeats) |
|---|---|---|
| A | P0 guardrail + P1 cache-safe saver | geomean ≥1.0x AND no task <0.9x |
| B | P2 turn-cutter warm start | geomean ≥1.5x (target 2.0x) AND no task <0.9x |
| C | P3 model cascade (only if B <2.0x) | geomean ≥2.0x AND no task <0.9x |

Each stage: own worktree, own PR, own benchmark table in the PR body,
independently revertable. A failed gate blocks merge — no exceptions.

Measurement harness: `scripts/run-megasaver-claude-limit-test.sh`
(`MEGA_SAVER_MODE=balanced`, run twice, report both). Fast-mode 2x billing is
per-batch noise; compare within-run arms only.

## Stage A — floor: never cost more than baseline

### P0 — ledger guardrail (workspace net-effect estimator + auto-pause)

The saver already persists raw chunk bytes per compression (chunk store) and
the proxy meters per-request usage (`proxy-usage/usage.jsonl`). Combine them in
`@megasaver/stats`:

- **Estimator:** per workspace, over a rolling 7-day window:
  `net = tokensSavedEstimate (raw−returned bytes → tokens, existing
  tokensFromBytes) − cacheChurnEstimate (megasaver-arm cache_creation in excess
  of the workspace's trailing per-turn append median)`. Both inputs already
  exist (overlay events + usage ledger); no new storage format — one new
  derived view + one persisted verdict file `stats/<wk>/net-effect.json`
  `{window, savedTokens, churnTokens, verdict, updatedAt}`.
- **Auto-pause:** verdict net-negative → saver decision path short-circuits to
  passthrough for that workspace. Doctor surfaces it:
  `saver-net-effect: NEGATIVE — auto-paused (run: mega saver resume)`.
  Resume = explicit command writing an override with its own 7-day re-check.
- Estimator is advisory-conservative: when either input is missing (proxy off,
  no ledger rows), verdict is `unknown` and the saver stays ON (never pause on
  missing data; pause only on measured negative).

Surfaces: `packages/stats` (estimator + view), `packages/context-gate`
(decision short-circuit), `apps/cli/src/commands/doctor-saver.ts` (check),
new `mega saver resume` subcommand.

### P1 — cache-safe saver (first-sight-only compression)

- **Session content-hash ledger** in the saver store: hash of each tool_result
  the saver has seen this session (sessionId already flows through the hook).
  Decision rule added at the TOP of `buildSaverDecision`: seen hash →
  **passthrough, never rewrite**. Rewriting only ever happens on first sight,
  before the client can have cached that turn.
- **Aggressive redefined:** modes now differ only in first-sight compression
  budget (how hard to compress novel bulk), never in re-compression. The
  "more compression = more churn" failure becomes structurally impossible.
- Compression footer loses per-call nondeterminism where feasible (stable
  chunk-set id derivation from content hash instead of randomUUID) so an
  identical tool output re-emitted in a NEW session compresses to identical
  bytes — cross-session cache friendliness.

Surfaces: `apps/cli/src/hooks/saver.ts` / `saver-run.ts`,
`packages/context-gate` (decision), chunk-set id derivation.

## Stage B — lever: turn-cutter warm start (P2)

Key discovery: the parts exist, the wire doesn't. `mega context build` already
produces task-aware context packs; `mega hooks intent` (UserPromptSubmit)
already receives the prompt and currently prints **nothing** to stdout.

- **Wire:** intent hook takes the redacted prompt it already persists, asks the
  daemon (existing discovery path, in-process fallback) for a pack, and emits
  `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit",
  "additionalContext": <pack>}}`.
- **Pack content** (budget 3-5k tokens, hard cap enforced):
  1. repo map summary (existing index),
  2. task-relevant Living Brain memories — **code-truth verified only** (stale
     memories are excluded, existing verify path),
  3. keyword-ranked candidate file list (paths + one-line summaries, NOT file
     contents — the model reads what it needs).
- **Determinism invariant:** the pack is computed once per session and is
  byte-stable for the session (cached alongside the intent record); repeated
  UserPromptSubmit events in interactive sessions re-emit the SAME bytes.
  A changing pack would re-introduce exactly the churn P1 kills. The pack
  registers in P1's hash ledger as first-sight content.
- **Failure mode:** any error/timeout (>500ms budget) → emit nothing
  (today's behavior). A missing pack must never delay or break a session.
- Expected mechanism (already signaled in benchmarks: megasaver arms at
  7 vs 11 turns): fewer blind Read/Grep exploration turns → reads (prefix ×
  turns) and append-writes drop together.

Surfaces: `apps/cli/src/hooks/` (intent), daemon endpoint reuse,
`packages/context-gate` / `mega context build` internals for pack assembly.

## Stage C — threshold: proxy model cascade (P3, LOCKED)

Design recorded; implementation forbidden until BOTH: Stage B measured <2.0x
AND explicit user approval in-session (risk-modes CRITICAL). Requires opt-in
config, an eval harness proving task outcomes unchanged on the benchmark
suite, and security-reviewer + critic passes.

- Proxy rewrites `model` to Haiku 4.5 for mechanical continuation turns only.
  Heuristic (conservative): request is a tool_result continuation AND novel
  (non-cached-prefix) content below a small threshold AND not the first or
  final turn AND no code-edit tool in the last assistant message. Everything
  else stays on the session model.
- The proxy today forwards bodies byte-verbatim; P3 breaks that invariant —
  the flag must be off by default, surfaced in `mega proxy status`, and the
  usage ledger must record original vs routed model per request.

## Testing (TDD, per stage)

- P0: estimator unit tests (net math, window edges, missing-input → unknown,
  pause/resume transitions); doctor check test.
- P1: decision-table tests — first sight compresses, seen hash passes through,
  mode budgets differ only on first sight; stable chunk-id derivation test.
- P2: pack golden tests (fixed fixture repo → byte-stable pack), budget cap
  test, determinism test (two emissions identical), timeout→empty test,
  stale-memory exclusion test.
- Integration per stage: the benchmark gate table itself, attached to the PR.

## Definition of done (per stage)

Spec §gates met with captured benchmark tables; `pnpm verify` green;
code-reviewer + critic (fresh contexts); wiki synthesis updated with measured
results; changeset per touched package. Stage C additionally: user approval
recorded + security-reviewer.

## Out of scope

- P4 prefix-diet (doctor cost surfacing of hook stacks), P5 keep-warm
  scheduler, P6 session fusion (`mega run --queue`): candidate follow-ups,
  intentionally excluded from these stages to keep attribution clean.
- No change to proxy byte-verbatim forwarding in Stages A/B.
- No change to the first-party flag path (shipped, robust).
