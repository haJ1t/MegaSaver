---
title: Context Gate pipeline & redaction flow
tags: [concept, context-gate, redaction, token-saver, aa1]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
status: active
created: 2026-05-11
updated: 2026-05-11
---

# Context Gate pipeline & redaction flow

The Context Gate is the mechanism behind "Mega Saver Mode": raw tool
output is filtered down to the most relevant, byte-budgeted excerpts
before the agent sees it, while the full raw stays local. This is the
product's core promise — *"Less tokens. More signal."* ([[concepts/contextops]]).

Naming (AA1 §2d, locked): users see **"Mega Saver Mode"**; code uses
`ContextGate` for the orchestrator and `tokenSaver` /
`TokenSaverSettings` / `TokenSaverMode` for the session-state object.

## The pipeline (redact-first)

For a read / command / grep / fetch, the flow is:

1. **Read gates** (file/exec only) — `policy.evaluatePathRead`
   (secret-path denylist) THEN `outputFilter.resolveSafeReadPath`
   (structural sandbox). Both must pass before any `fs.readFile`.
2. **redact** — `policy.redact(raw)`. Runs FIRST inside `filterOutput`
   so secrets never reach a persistence call (§11b critical ordering).
3. **normalize → collapse → chunk → rank → dedupe → fit → summarize →
   compose** — `outputFilter.filterOutput` (pure, no IO). Produces
   `{ summary, excerpts, rawBytes, returnedBytes, bytesSaved, savingRatio }`.
4. **persist** — `contentStore.saveChunkSet` writes the raw chunk set
   to `<store>/content/<projectId>/<sessionId>/<chunkSetId>.json`.
5. **stats** — `stats.appendEvent` + session summary at
   `<store>/stats/<projectId>/<sessionId>.json` (spec target; NOT yet
   wired as of BB7a — see below).

## Redaction flow (security-critical)

Redaction is owned by [[entities/policy]] (`redact`) and runs at
pipeline stage 2, BEFORE any chunk is persisted (AA1 §9, plan L1248).
The F-MAJ-3 invariant: a session with `redactSecrets === true` must
never persist a chunkSet with `redacted: false`. Default-deny
secret-path reads ([[entities/policy]] `evaluatePathRead`) stop the
pipeline before a secret file is even opened.

## Where the orchestrator lives (shipped vs spec)

AA1 §2a/§8d proposed a single `packages/core/src/context-gate/`
orchestrator (`run.ts`, `enable.ts`, `disable.ts`) shared by the CLI
and the future MCP bridge — "one orchestrator, two entry points". As
of BB7a (PR #73) that directory does **not** exist. BB7a composes the
pipeline CLI-side in `apps/cli/src/commands/output/shared.ts`
(`resolveEffectiveSettings`, `runTwoGates`, `readAndFilter`,
`persistChunkSet`), and `@megasaver/core` gained no new package deps.
Stats events are not appended yet (chunkSets persist; events don't).
The shared-orchestrator extraction + stats wiring are deferred to
BB7b (the spawning `mega output exec`) / BB8 (the MCP bridge).

## Package roles

- [[entities/shared]] — `TokenSaverMode` + `modeToBudget` (the single
  mode→byte-cap source; hoisted here to avoid a core cycle, §2e).
- [[entities/core]] — `Session.tokenSaver` field, `TokenSaverSettings`,
  `updateTokenSaver` registry method.
- [[entities/policy]] — command gate, path-read gate, `redact`.
- [[entities/output-filter]] — `filterOutput` pipeline,
  `resolveSafeReadPath`, `RankFeatureName`, `OutputSourceKind`.
- [[entities/content-store]] — ChunkSet persistence.
- [[entities/retrieval]] — BM25 ranking + intent derivation.
- [[entities/stats]] — savings event ledger + session summary.
- [[entities/cli]] — `mega session saver` (toggle) + `mega output`
  (run the pipeline).

## Dependency direction (§3c — no cycles)

`shared` ← {policy, output-filter, content-store, retrieval, stats} ←
`core`. None of the five new packages may import `core`
([[decisions/content-store-no-core-edge]]). The arrow matches the
[[concepts/agent-agnostic-core]] discipline: leaf packages return data,
core composes.
