---
title: Live Context Seam
date: 2026-07-01
status: approved
risk: HIGH
scope: Slices 0–4 (defer 5)
reviewers: [architect, critic, code-reviewer]
branch: feat/core-live-context-seam
---

# Live Context Seam

## Problem

MegaSaver already ships every engine the "SCoG / synthetic context" direction
asks for — `context-pruner.buildContextPack` (8-factor task-scoped pack builder),
`output-filter` engine ranking with `failureHistoryBoost`/`memoryBoost`,
`retrieval.deriveIntent`, and `core` failure/memory data. What it lacks is the
**wiring** that makes them fire on live session state.

Verified against source (2026-07-01):

1. **Auto failure capture does not exist.** All four `FailedAttempt` writes are
   manual (`record_failed_attempt` tool, `record_task_step recordFailure`,
   `mega fail record`, `mega task step --record-failure`).
   `output-filter.classifyOutput` detects vitest/pytest/cargo/typescript failure
   categories but feeds only compression dispatch — never failure memory.
   Evidence: `mcp-bridge/src/tools/failed-attempts.ts:75`, `output-filter/src/classify.ts:101`.
2. **`sessionHints` is never passed in production.** All three `filterOutput`
   callers omit it, so `failureHistoryBoost` / `memoryBoost` / `recentFileScore`
   are **always 0** today — the engine-ranking boost path is dormant.
   Evidence: `context-gate/src/run-command.ts:230,380`, `context-gate/src/read.ts:164`,
   `output-filter/src/rank.ts:151-173`.
3. **No orchestrator seam.** mcp-bridge exposes 26 stateless tools with zero
   coordination. `retrieval.deriveIntent` is not imported anywhere in mcp-bridge.
   `buildContextPack` is reachable via `handleGetRelevantContext`;
   `buildImpactPack` via `handleImpact`. Evidence: `mcp-bridge/src/server.ts:258-280`,
   `mcp-bridge/src/tools/context-pruning.ts:96-131`.
4. **Two failure consumers, different triggers** (correctly separated already):
   `context-pruner` scores code blocks from a static `failingTests[]` param
   (`score.ts:103`, weight 2.5, force-include at `select.ts:57`); `output-filter`
   ranks tool-output chunks from `sessionHints.recentFailures` (weight 0.15).
   `buildImpactPack` is **edit-time** (requires a known symbol FQN) and consumes
   no failures.
5. **Injection is PUSH via managed block, but no init instruction.** The connector
   block tells the agent to prefer proxy tools, but nothing instructs it to call a
   context tool at task start. No determinism snapshot test guards a ranking change.
   Evidence: `connectors/shared/src/context-gate-block.ts:14-59`,
   `output-filter/test/rank-engine.test.ts:47`.

**The real net-new is a three-link chain that does not exist:**
`(produce failures automatically) → (build sessionHints from them) → (pass sessionHints into filterOutput)`.
"Flip `failureHistoryBoost` to default-on" is a no-op mirage — nothing supplies
the data.

## Non-goals (explicitly deferred)

- New `@megasaver/scog` package — duplicates the shipped 8-factor scorer.
- Separate LLM "planner" / program-graph service — replaces free deterministic
  graph traversal with paid, non-deterministic infra.
- Slice 5: impact-pack on edit (`buildImpactPack`, edit-time) — separate trigger
  surface, its own later spec.
- Semantic-type scorer weights, non-TS FQN resolution, AST-region locking / CRDT
  merge — YAGNI until a real task breaks without them.
- Always-on global interceptor — violates the mission non-negotiable ("proxy is
  never on unless the operator points an agent at it").

## Locked decisions

- **Scope:** Slices 0–4. Defer 5.
- **Failure record durability:** ephemeral, session-scoped. Auto-captured failures
  live only in-session, feed ranking, expire at session end. Durable
  `FailedAttempt` stays manual (unchanged).
- **Seam attachment:** composite MCP tool `get_task_context` (reuse
  `handleGetRelevantContext` + `deriveIntent`). No pre-dispatch middleware, no
  all-tool control-flow change.
- **Risk:** HIGH (§12) — context packer + evidence-preserving path + public tool
  surface. Worktree only; architect + critic + code-reviewer in separate contexts.

## Design

### Slice 0 — determinism / evidence guard (built first, TDD)

Golden-corpus snapshot tests, added **before** any behavior change, so every later
slice must preserve them:

- `context-pruner`: fixed blocks + task → `buildContextPack` returns a stable
  `included`/`excluded` ordering; `excluded[]` entries remain recoverable via
  their `chunkSetId`.
- `output-filter`: fixed output + fixed `sessionHints` → `filterOutput` ranking
  order is stable; evidence-preservation invariants (distinct ports/hashes/error
  codes/line numbers never folded) still hold.

Purpose: any inadvertent reorder or evidence loss from Slices 1–3 fails a test.
Files: `packages/context-pruner/test/`, `packages/output-filter/test/`.

### Slice 1 — automatic failure capture (ephemeral)

New `SessionFailure` type + in-session store in `@megasaver/core`. NOT the durable
registry.

```
SessionFailure {
  text: string            // the failure evidence (compressed first-failure span)
  category: string        // from classifyOutput: vitest | typescript | pytest | cargo | ...
  source: 'proxy-classifier'
  timestamp: string
  scope: 'session'
  expires: 'session-end'
}
```

In `context-gate/src/run-command.ts`, after `classifyOutput` returns a failure
category for a proxied command/test output, append a `SessionFailure` to the
session store. Durable `FailedAttempt` path is untouched. Satisfies §13 ("no
memory writes without metadata") within session scope, with no durable-memory
pollution.

Files: `packages/core/src/` (new `session-failure.ts` + session-store hook),
`packages/context-gate/src/run-command.ts`.

### Slice 2 — sessionHints builder + wire the call sites

New builder assembles `sessionHints` from live state:

- `recentFailures` ← `SessionFailure[]` (Slice 1)
- `recentMemory` / `projectConventions` ← memory-graph / project metadata
- `recentFiles` ← current session read log

Pass the built `sessionHints` into the three `filterOutput` call sites that
currently pass nothing: `run-command.ts:230`, `run-command.ts:380`, `read.ts:164`.
This activates the dormant `failureHistoryBoost` / `memoryBoost` — the true
"default-on": supply the data, not flip a flag.

Cost control: session-cache the hints; rebuild on new `SessionFailure` / memory
change, not per tool call.

Files: `packages/context-gate/src/` (new hints builder), edits to the three call
sites.

### Slice 3 — proactive seam: `get_task_context`

New composite tool. Chain:

```
intent = deriveIntent({task, sessionTitle, recentMemory, cliCommand, filePaths})   // retrieval — import (currently unused in mcp-bridge)
  → buildContextPack(task, blocks, changedFiles, failingTests, memoryFiles, taskVector)
        // task = intent-normalized string; taskVector from intent when embeddings available
        // reuse handleGetRelevantContext / context-pruning.ts pack path
  → return ContextPack { included, excluded, budget }  // budget carries tokensBefore/tokensAfter/percentSaved
```

Cache the pack per `(sessionId, intentHash, changedFilesHash)`.

Files: `packages/mcp-bridge/src/tools/` (new `task-context.ts`, registered in
`TOOL_DEFS` + dispatch), reusing `context-pruning.ts` pack path.

### Slice 4 — injection bootstrap

Add one instruction line to the connector managed block: at task start, call
`get_task_context`. Gated on `tokenSaver.enabled` (matches existing block
gating). PUSH-instruction only — the tool stays opt-in; no global hook.

Files: `packages/connectors/shared/src/context-gate-block.ts`.

## Data flow

```
proxied command/test output
  → classifyOutput  ──(failure category)──►  SessionFailure store        [Slice 1]
                                                    │
task start ──► get_task_context ──► deriveIntent ──► buildContextPack ──► pack to agent   [Slice 3,4]
                                                    │
tool output ──► filterOutput(sessionHints ← SessionFailure + memory) ──► ranked output    [Slice 2]
```

Single producer (`SessionFailure`), two consumers (pack scoring at task-start via
`failingTests`; output ranking at runtime via `recentFailures`).

## Testing strategy

- **Slice 0:** the guard suite itself (determinism + evidence snapshots).
- **Slice 1:** failing-classified output → exactly one `SessionFailure` with full
  metadata; non-failure output → none; durable `FailedAttempt` count unchanged.
- **Slice 2:** two calls where the first fails → second call's `filterOutput`
  ranks the failing area higher (non-zero `failureHistoryBoost`); Slice-0 snapshots
  still pass.
- **Slice 3:** `get_task_context` returns a pack with `percentSaved > 0`; same
  inputs → same pack (determinism); pack cache hit on repeated call.
- **Slice 4:** rendered connector block contains the init instruction iff
  `tokenSaver.enabled`; sentinel-bounded, idempotent across re-sync.

Each slice: TDD red → green. `pnpm verify` green before slice boundary.

## Measurement

Extend `stats` A/B: seam-on vs seam-off comparing **tokens + session-failure-count
+ re-read-count** — not `percentSaved` alone (pruner already reports that). Goal:
prove the seam reduces re-reads and repeated failures, not just raw bytes.

## Risks

- **Evidence stripping** (§13 anti-pattern) — mitigated by Slice 0 guard first.
- **Latency tax on a token-saver** — mitigated by session-cached hints + packs.
- **Opt-in boundary** — capture + seam live only inside the proxy/bridge path the
  operator pointed an agent at; never global.
- **Determinism** — snapshot tests catch ranking drift from any boost activation.

## Out-of-scope confirmation

Slice 5 (impact-pack/edit-time), semantic-type weights, non-TS FQN, LLM planner,
program-graph service, AST-locking. Revisit only on measured need.
