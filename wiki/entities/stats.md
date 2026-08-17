---
title: '@megasaver/stats'
tags: [entity, package, stats, telemetry, v0.5, aa1]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
  - docs/superpowers/specs/2026-06-12-proxy-mode-v1.2-design.md
status: active
created: 2026-05-11
updated: 2026-06-14
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
- **Discover scanner (v2.7 #3, 2026-08-13, `src/discover.ts`)**:
  `parseHookLogRows` (lenient hook-log reader, `agent` carried not gated),
  `scanExposure` (pure classifier: five bypass causes + `aboveFloor` +
  top-5 per-file rollup + windowed origin-split mediated fold), caveat
  constants, `hookLogRowSchema`. Honest-metrics discipline: bytes only
  from measurements, tokens via `tokensFromBytes` labeled `(est.)`, no
  price fields (structurally asserted).
- `readWorkspaceOverlayEvents(store, workspaceKey)` (`src/store.ts`) —
  folds every session's `*.events.jsonl` for a workspace (lenient per
  line, `readOverlayEvents` reuse); the discover context source.

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

## Phase 8 — Audit dashboard (2026-06-12)

Phase 8 **extends this package** rather than adding a parallel entity in
core (decision (a)). Additive, the existing `TokenSaverEvent` byte-log
and `SessionTokenSaverStats` are untouched:

- A second event family **`AuditEvent`** (discriminated union of five
  scalar-only kinds) written to a sibling log
  `<store>/stats/<projectId>/<sessionId>.audit.jsonl` via
  `appendAuditEvent` (mirrors `appendEvent` mechanics).
- A pure **`summarizeAudit(events, opts)`** — arithmetic + grouping with
  window filtering (`session | week | all`); unit-testable, no store.
- A thin **`readAuditEvents(store, projectId, sessionId?)`** reader
  (rejects a partial tail).
- Core **re-exports** the four new symbols (apps must not import stats
  directly — §3c cycle guard). Surfaced by the `audit_token_usage` MCP
  tool (23 → 24) and the `mega audit report/last/session/export` group.

Concept: [[concepts/audit-dashboard]].

## v1.2 — Proxy Mode metrics (2026-06-14)

P5 (commit `07040de`) adds two metric families on top of the byte ledger.
See [[concepts/proxy-mode]].

- **Proxy adoption** — universal: reported whenever proxy tools are the
  exposed surface, no extra telemetry needed.
- **Hook-based interception** — reported ONLY when the Claude Code
  PreToolUse jsonl log exists (written by `mega hooks log`). When it does
  not, stats degrades to adoption-only plus an install hint
  (`mega hooks install`) rather than fabricating an interception number.

**Honest-metrics rule:** never overclaim. Interception requires the
hook-log evidence on disk; absent it, stats shows adoption only. Mirrors
the no-fake-savings stance in [[entities/output-filter]].

## Two layouts share `stats/` — never conflate them (2026-07-25)

`stats/` holds BOTH layouts: registry sessions at
`stats/<projectId>/<sessionId>.json` (`sessionTokenSaverStatsSchema`) and the F4
overlay at `stats/<workspaceKey>/<liveSessionId>.json`
(`overlaySessionTokenSaverStatsSchema`). Both schemas are `.strict()`, so each
rejects the other's file as `store_corrupt`.

`reconcileOverlaySummaries` (daily GC sweep) walked every dir as an overlay
workspace and rewrote registry summaries as zeroed overlay ones — after which
`readSummary`/`appendEvent` threw `store_corrupt` forever and `mega output
exec/file/filter` returned `store_write_failed`. It also fabricated one phantom
summary per non-session ledger (`handoff` / `guard` / `warm-start` /
`code-truth` `.events.jsonl`).

**Rule:** EVERY walk of `stats/*` must first discriminate the layout — overlay
dirs are 16 lowercase hex (`workspaceKeySchema`, from `encodeWorkspaceKey`),
registry dirs are UUIDs. Same discriminator `locateChunkSet` uses
(`packages/context-gate/src/locate-chunk-set.ts:11`). Fix: branch
`fix/gc-reconcile-clobbers-legacy-summaries`, guard test
`packages/stats/test/reconcile-legacy-layout.test.ts`.

That fix guarded `reconcileOverlaySummaries` only, and the rule it left behind
("read-only walks are safe because they schema-filter") was wrong: overlay
summary reads are SELF-HEALING, so a schema miss WRITES
(`loadOverlaySummarySelfHealing` → `rebuildGuarded` → `atomicWriteFile`).
`readOverlaySummaryAnyWorkspace` therefore destroyed the same registry
summaries on a plain read, reachable from `mega audit session`, `mega audit
honest` (which never consults the registry) and `mega hooks status --session`.
All three `stats/*` walkers in `store.ts` now share one `overlayWorkspaceKeys`
helper that applies the discriminator. Post-merge review finding C1; branch
`fix/review-C1-stats-sibling-clobber`, guard test
`packages/stats/test/read-overlay-any-workspace.test.ts` ("leaves a legacy
registry summary intact"). Fixture keys in the CLI overlay tests were fake
(`workspace-aaa`, `wk-alpha`) and are now real 16-hex keys.

**Class note:** a merged fix that guards ONE walker is not a fixed defect class.
Grep every sibling walker (`readdirSync(join(root, "stats"))`) before closing.

## Cost Ledger (C4, 2026-08-18)

- `buildCostLedger` (`src/cost-ledger.ts`): pure aggregator grouping spend receipts (`SpendReceipt`) and savings receipts (`SavingsReceipt`) by facet (`project`, `task`, `agent`, `session`).
- Receipts only (tokens, not dollars): attribution is never guessed — unattributable receipts land in `UNKNOWN_COST_BUCKET = "UNKNOWN"` and are sorted last.
- Savings receipts only count measured before/after pairs (`deltaTokens`); unmeasured rows count towards `unmeasuredSavingsRows`, never converted via bytes/4.

## Related

- [[entities/output-filter]] — emits the byte metrics; owns
  `OutputSourceKind`.
- [[entities/retrieval]] — shipped in the same PR (BB6).
- [[entities/cli]] — `mega hooks {install,status}` writes the hook log; `mega cost` provides the unified rollup.
- [[concepts/context-gate-pipeline]] — stats sit at the tail of the flow.

