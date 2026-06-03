---
title: Context Gate — folded vs extracted (AA1 §2a)
tags: [decision, architecture, context-gate, aa1]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
status: active
created: 2026-05-13
updated: 2026-06-03
---

# Context Gate — folded vs extracted

AA1 §2a folded the Context Gate orchestrator into `@megasaver/core`
(`packages/core/src/context-gate/`) for BB1–BB7b, with a deferred
trigger: if the orchestrator exceeds **500 LOC** after BB7b, extract
it to a standalone `@megasaver/context-gate` package (BB12); otherwise
keep it folded (source: AA1 §2a).

## Measurement (2026-05-13, post-BB7b)

`wc -l packages/core/src/context-gate/*.ts` total = **553** LOC
(`fetch-chunk.ts` 37, `locate-chunk-set.ts` 31, `read.ts` 113,
`run-command.ts` 280, `run.ts` 70, `types.ts` 22).

## Outcome

553 > 500 → **EXTRACT (queued as BB12).** The threshold fires, so the
orchestrator is slated to move to a standalone `@megasaver/context-gate`
package importing the domain packages and re-exported by
`@megasaver/core` to preserve the public surface (source: AA1 §2a).
The cycle-risk argument still governs the design — a coordinator that
imports every domain package would close a dependency cycle if it lived
*in* a leaf, so the new package sits above the leaves and below `core`'s
public re-export (source: AA1 §3c, §19a).

The extraction is **not** performed by the v1.0 closeout: it is its own
PR (BB12, ~553 LOC moved) with spec + plan already landed (PR #82). The
closeout only records the measurement and disposition; the folded code
ships in v1.0 unchanged.

## PR #75

Orchestrator-extraction evaluation: **MERGED** — it created
`packages/core/src/context-gate/` (the folded orchestrator). The >500
LOC reading then queues the standalone-package promotion as BB12.
<https://github.com/haJ1t/MegaSaver/pull/75>

## BB12 — EXECUTED (PR #88, 2026-06-03)

The extraction queued above was performed in PR #88 as a standalone
commit. Outcome:

- `packages/core/src/context-gate/` (605 LOC at extraction time)
  moved to `packages/context-gate/src/`.
- New package: `@megasaver/context-gate@0.2.0`.
- `OrchestratorRegistry` structural port: `context-gate` declares its
  own read-only registry interface so it imports **zero** `@megasaver/core`
  symbols (cycle-free by construction).
- `@megasaver/core` re-exports the full `context-gate` public surface.
  Consumers that `import … from "@megasaver/core"` are unchanged.
- `dependency-graph.test.ts` relocated to `packages/context-gate/`.

The folded orchestrator no longer lives in core. The disposition
recorded at v1.0 closeout ("extraction queued as BB12") is now fully
resolved. See [[entities/context-gate]].
