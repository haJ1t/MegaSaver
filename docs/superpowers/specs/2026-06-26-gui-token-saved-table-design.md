---
feature: gui-token-saved-table
date: 2026-06-26
risk: LOW
status: approved-design
reviewers: [code-reviewer]
---

# GUI Token Saver — "tokens saved" mini table

## Problem

The cockpit Token Saver panel's "Stats (this session)" section shows *what*
was compressed: a 7-row byte summary (Events, Raw/Returned/Bytes-saved bytes,
Saving ratio, Chunks stored, Last save) plus a per-event table (when / source /
label / raw / returned / saved). The user does not want the per-item compression
detail. They want a single, focused answer: **how many tokens MegaSaver saved
from what Claude Code would otherwise have spent.**

## Goal

Replace the stats display with a 3-row mini table, in tokens:

| Row | Value |
|-----|-------|
| Would have used | `tokens(rawBytesTotal)` |
| Actually used | `tokens(returnedBytesTotal)` |
| Saved | `tokens(rawBytesTotal) − tokens(returnedBytesTotal)` |

Nothing else — no per-event table, no byte counts, no ratio, no chunk count.

## Non-Goals (YAGNI)

- No fixed context-window limit / "% of limit" (the tool does not know Claude
  Code's actual window; show only measured savings).
- No per-event / "what was compressed" detail.
- No changes to how stats are recorded or fetched server-side.
- No CLI (`mega audit`) change.

## Decisions (locked)

1. Content: Would-have-used / Actually-used / Saved, in tokens, from measured
   `OverlaySessionTokenSaverStats` (no external limit).
2. Target: GUI cockpit Token Saver panel only.
3. Keep functional controls (HookConnection, SaverModeActivation,
   DaemonStatusPanel), live indicator, loading/error/empty states.

## Token conversion

`tokens(bytes) = Math.ceil(bytes / 4)` — a local helper in the panel, matching
the canonical `tokensFromBytes` in `@megasaver/stats`
(`packages/stats/src/honest-metrics.ts:96`). Replicated locally (one line)
rather than imported, because `@megasaver/stats` is node-coupled and must not be
pulled into the browser bundle. `Saved` is computed as
`tokens(raw) − tokens(returned)` so the three rows are internally consistent.

## Components

`apps/gui/src/views/cockpit/token-saver-panel.tsx`:

- Remove the 7-row `SummaryRow` byte table and the per-event `<table>`.
- Remove the events fetch (`fetchSessionTokenSaverEvents`), the `events` state,
  and the `OverlayTokenSaverEvent` import — only `fetchSessionTokenSaverStats`
  remains.
- Add a 3-row table (reusing the existing `SummaryRow` for label/value rows):
  Would have used, Actually used, Saved. Format values with thousands
  separators + " tokens" suffix; emphasize the Saved row.
- Remove now-unused helpers (`fmtBytes`; `fmtTimestamp` if no longer used).
- Keep the "No proxy activity recorded for this session." empty state.

## Error handling

Unchanged: silent poll keeps last good data; loading/error states as today. A
null `stats` shows the existing empty-state message.

## Testing

Update `apps/gui/test/components/token-saver-panel.test.tsx`:

- Given a stats fixture (`rawBytesTotal`, `returnedBytesTotal`,
  `bytesSavedTotal`), assert the three rows render with the correct **token**
  numbers (`Math.ceil(bytes/4)`, thousands-separated).
- Assert the byte-summary rows ("Raw bytes", "Saving ratio", "Chunks stored")
  and the per-event table headers ("source", "label") are **gone**.
- Empty state (`stats === null`) still renders the no-activity message.

## Verification

`pnpm --filter @megasaver/gui test`, `pnpm --filter @megasaver/gui build`,
scoped biome, and full `pnpm test` before push. No changeset (`apps/gui` is not
a published package).
