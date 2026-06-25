---
title: '@megasaver/context-gate'
tags: [entity, package, context-gate, orchestrator, aa1, v1.1]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
  - docs/superpowers/specs/2026-06-25-intent-aware-hook-design.md
  - docs/superpowers/specs/2026-06-25-diff-on-reread-design.md
  - docs/superpowers/specs/2026-06-26-semantic-ast-read-design.md
status: active
created: 2026-06-03
updated: 2026-06-26
---

# `@megasaver/context-gate`

Standalone orchestration package extracted from `@megasaver/core` in
BB12 (PR #88). Version `0.2.0`. The extraction was triggered by the
AA1 §2a rule: context-gate directory in core measured 553 LOC (> 500
threshold) post-BB7b; see [[decisions/context-gate-extraction]].

## Why a separate package

If the orchestrator lived in a **leaf** package it would close a
dependency cycle (a leaf importing every other leaf). If it stayed in
**core** it violated the §3c rule that leaf packages must not import
core. A coordinator above the leaves and below core's public re-export
is the only cycle-safe home (source: AA1 §2a, §3c, §19a).

`@megasaver/core` re-exports the full context-gate surface, so all
existing callers continue to `import … from "@megasaver/core"` without
any change.

## Exported surface

- `runOutputPipeline(input)` — the shared engine for `mega output
  {file,filter,exec}` and `mega_run_command`. Redact → chunk → rank →
  fit → summarize → persist.
- `runOutputExecCommand(input)` — child-process spawn variant: policy
  gate → spawn with `MEGASAVER_ORIGIN_PID` env-marker → pipe stdout/stderr
  through `runOutputPipeline`.
- `fetchChunk(chunkSetId, chunkId, around?)` — drill into a stored
  excerpt from content-store.
- `recordAndFilterOverlayOutput(input)` (2026-06-15) — filters an
  ALREADY-PRODUCED output buffer (no re-exec, no path gating), stores the
  FULL redacted output as a recoverable overlay chunk, and
  `appendOverlayEvent` keyed by `(workspaceKey, liveSessionId)`. Powers
  the `mega hooks saver` PostToolUse hook → populates the live GUI Token
  saver overlay stats. Generalizes the file-only `runOverlayOutputPipeline`.
  Takes an optional `intent` threaded into `filterOutput` → `scoreChunk` as
  the ranking intent (FILL-GAP; see [[intent-aware-hook]], PR #180).
  Fix (PR #140, 2026-06-15): the stored chunk-set's `source` now maps from
  `input.sourceKind` to the matching discriminated-union variant
  (`command`/`grep`/`fetch`/`file`) instead of always `{kind:"file"}` — a
  Bash command was previously recorded as a file path (cosmetic metadata only;
  hook behaviour + lossless recovery unaffected).
- `loadProjectPermissions(rootDir)` — reads `.megasaver/permissions.yaml`
  (yaml@^2 I/O) and returns `ProjectPermissions | null`. Used by
  `evaluateCommand` / `evaluatePathRead` for tighten-only project rules.
- `OrchestratorRegistry` — structural port of `CoreRegistry`'s read
  surface (the orchestrator only reads sessions/projects; it does not
  mutate). Declared locally so `context-gate` has zero `@megasaver/core`
  dependency.

## Dependencies

`content-store`, `output-filter`, `policy`, `shared`, `stats`, `yaml`.
MUST NOT import `@megasaver/core` (enforced by `dependency-graph.test.ts`
relocated here from core).

## Boundary rules (§3c cycle guard)

- Above all AA1 leaf packages in the dependency graph.
- Below `@megasaver/core`'s re-export boundary.
- Zero `@megasaver/core` import — `OrchestratorRegistry` is a structural
  duck-type; concrete `CoreRegistry` implementations satisfy it without
  a shared interface import.

## Implementation

PR #88 (`@megasaver/context-gate` extraction, BB12). 605 LOC moved.
`OrchestratorRegistry` structural port breaks the core import cleanly.
`@megasaver/core` re-exports: consumers import via core unchanged.
context-gate@0.2.0.

## Read pipeline (v1.1, June 2026)

- **Split** `readAndFilter` → `readRaw` (fs read) + `filterRaw` (thin
  `filterOutput` wrapper); `readAndFilter` kept as a wrapper (code:
  src/read.ts, PR #181).
- **Unchanged-suppression short-circuit** in BOTH `runOutputPipeline`
  (registry: `projectId`/`sessionId`) and `runOverlayOutputPipeline`
  (overlay: `workspaceKey`/`liveSessionId`): read raw → `hashContent` (sha256)
  → look up the on-disk per-session read-index keyed by `hashPath` (sha256 of
  absolute path — no raw paths on disk); hit + match returns a lossless
  `unchangedResult` (`decision: "unchanged-marker"`, empty excerpts,
  `unchanged.priorChunkSetId` still expandable), skipping filter/persist
  (code: src/run.ts, src/read-index.ts). `recordRead` runs only AFTER persist
  so `priorChunkSetId` always resolves. See [[diff-on-reread]] (PR #181);
  read-index uses `READ_INDEX_FILENAME` + `atomicWriteFile` from
  [[content-store]].
- **Async propagation** (PR #182): `filterRaw`/`readAndFilter` now `await`
  `filterOutput`, which became async when [[output-filter]] lazy-loads the
  TS compiler for AST-aligned chunking.

## Related

- [[decisions/context-gate-extraction]] — the §2a measurement + BB12 disposition.
- [[entities/core]] — re-exports this package's surface.
- [[entities/mcp-bridge]] — `mega_run_command` calls `runOutputExecCommand`.
- [[entities/cli]] — `mega output exec` calls `runOutputExecCommand`.
- [[entities/policy]] — `loadProjectPermissions` delegates to `policy.parseProjectPermissions`.
- [[concepts/context-gate-pipeline]] — the end-to-end Mega Saver Mode flow.
