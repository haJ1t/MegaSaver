---
title: '@megasaver/stats'
tags: [entity, package, stats, telemetry, v0.5, aa1]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
status: active
created: 2026-05-11
updated: 2026-06-10
---

# `@megasaver/stats`

Token-saver event ledger and session-savings summary for the Context
Gate. Tracks `rawBytes` / `returnedBytes` / `bytesSaved` /
`savingRatio` per filtered output so the GUI can show "X% saved".
Shipped BB6 (PR #71, `6078dc9`, alongside `@megasaver/retrieval`).
Risk MEDIUM.

## On-disk layout

```
<store>/stats/<projectId>/<sessionId>.json          (session summary; atomic)
<store>/stats/<projectId>/<sessionId>.events.jsonl  (append-only event log)
```

The summary is written atomically (own `src/atomic-write.ts` — no core
import); events are appended line-by-line (JSONL parse rejects a
partial last line).

## Public surface (`packages/stats/src/index.ts`)

- `appendEvent(input: AppendEventInput)` — append a `TokenSaverEvent`
  to the events JSONL (`src/store.ts`).
- `readSummary(...)` — read the `SessionTokenSaverStats` summary.
- `resetOnDisable(...)` — §13c reset: KEEP the events JSONL (audit
  trail / evidence per plan principle #1), ZERO the session-summary
  running totals. (Tentative — may flip to "preserve summary, show
  lifetime savings" in BB10.)
- `tokenSaverEventSchema` / `TokenSaverEvent` (`src/event.ts`). Event
  `sourceKind` type-imports `OutputSourceKind` from
  `@megasaver/output-filter` (F-MAJ-4 — no local enum); `mode` imports
  `tokenSaverModeSchema` from `@megasaver/shared`.
- `sessionTokenSaverStatsSchema` / `SessionTokenSaverStats`
  (`src/summary.ts`).
- `StatsStore` type; `StatsError` + `statsErrorCodeSchema`
  (`schema_invalid`, `store_corrupt`, `write_failed`).

## Boundary rules (§3c cycle guard)

- May depend on: `@megasaver/shared` + `@megasaver/output-filter`
  (`OutputSourceKind` type).
- MUST NOT depend on: `@megasaver/policy`, `@megasaver/core`.
  Dep-graph test enforces.

## Wiring status (completed 2026-06-10)

Both orchestrator paths record events:

- **Exec path** (BB7b): `runOutputExecCommand` →
  `appendEvent` (`packages/context-gate/src/run-command.ts`).
- **File-read path** (stats-wiring-completion, 2026-06-10):
  `runOutputPipeline` builds a `sourceKind: "file"` event and calls
  `appendEvent` (`packages/context-gate/src/run.ts`); failures map to
  the new `RunOutputResult` member `store_write_failed` in all three
  consumers (`mega output file`/`filter`, MCP `mega_read_file`).
- **CLI readout**: `mega session saver stats` reads `readSummary` via
  the core re-export (BB6 stub retired). GUI bridge reads summary +
  events directly.

Core re-exports `appendEvent`/`readSummary`/types so apps/cli honors
its dependency-graph pin (no direct stats dep).

## Related

- [[entities/output-filter]] — emits the byte metrics; owns
  `OutputSourceKind`.
- [[entities/retrieval]] — shipped in the same PR (BB6).
- [[concepts/context-gate-pipeline]] — stats sit at the tail of the flow.
