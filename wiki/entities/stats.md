---
title: '@megasaver/stats'
tags: [entity, package, stats, telemetry, v0.5, aa1]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
status: active
created: 2026-05-11
updated: 2026-05-11
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

## Wiring status

BB6 ships the package surface. As of BB7a the `mega output`
commands persist chunkSets but do NOT yet `appendEvent` — stats
wiring is deferred to BB7b / BB8.

## Related

- [[entities/output-filter]] — emits the byte metrics; owns
  `OutputSourceKind`.
- [[entities/retrieval]] — shipped in the same PR (BB6).
- [[concepts/context-gate-pipeline]] — stats sit at the tail of the flow.
