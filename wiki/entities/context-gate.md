---
title: '@megasaver/context-gate'
tags: [entity, package, context-gate, orchestrator, aa1, v1.1]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
status: active
created: 2026-06-03
updated: 2026-06-03
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

## Related

- [[decisions/context-gate-extraction]] — the §2a measurement + BB12 disposition.
- [[entities/core]] — re-exports this package's surface.
- [[entities/mcp-bridge]] — `mega_run_command` calls `runOutputExecCommand`.
- [[entities/cli]] — `mega output exec` calls `runOutputExecCommand`.
- [[entities/policy]] — `loadProjectPermissions` delegates to `policy.parseProjectPermissions`.
- [[concepts/context-gate-pipeline]] — the end-to-end Mega Saver Mode flow.
