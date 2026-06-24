---
title: Token-saver "when" column (per-save timestamp)
status: approved
risk: LOW
created: 2026-06-24
sign-off: user approved 2026-06-24 (local YYYY-MM-DD HH:MM:SS; add "Last save" summary row)
sources:
  - apps/gui/src/views/cockpit/token-saver-panel.tsx
---

# Token-saver "when" column

## Problem

The token-saver cockpit panel already lists each save as a table row
(source, label, raw, returned, saved, %), but never shows **when** the save
happened. The data is present — each `OverlayTokenSaverEvent` carries an ISO
`createdAt`, and the session summary carries `updatedAt` — they are just not
rendered. The user wants to see, per save, the exact date + time to the second.

## Goal

Show the timestamp of each save in the per-save table (date + hour:minute:
second, local time), and show the session's last-save time in the summary.

## Design

Pure GUI render change in one file
(`apps/gui/src/views/cockpit/token-saver-panel.tsx`). No client/bridge/schema
change — `createdAt` and `updatedAt` are already in the GUI types
(`OverlayTokenSaverEvent.createdAt`, `OverlaySessionTokenSaverStats.updatedAt`).

1. **`fmtTimestamp(iso: string): string`** — pure, exported helper. Parses the
   ISO string and formats local `YYYY-MM-DD HH:MM:SS` (zero-padded). Built from
   `Date` local parts (not `toLocaleString`) so the output is deterministic and
   testable. On an unparseable input, returns the raw string (defensive — the
   value is display-only).

2. **Per-save table:** add a leading `when` column. Header `when`; each row
   renders `fmtTimestamp(ev.createdAt)` (monospace/tabular). Column order:
   `when, source, label, raw, returned, saved, %`.

3. **Summary table:** add a `Last save` row showing `fmtTimestamp(stats.updatedAt)`.

## Testing (TDD)

- `fmtTimestamp`: a `Date` built in local time → `toISOString()` → `fmtTimestamp`
  round-trips to the expected `YYYY-MM-DD HH:MM:SS` (timezone-independent because
  both build/read use local parts); zero-padding (single-digit month/day/time);
  unparseable input returns the raw string.
- Component: the events table renders a `when` header and a formatted timestamp
  cell for an event; the summary renders a `Last save` row.

## Risk

LOW — display-only, one file, no logic beyond formatting. `pnpm verify` +
component test; single code-review pass.
