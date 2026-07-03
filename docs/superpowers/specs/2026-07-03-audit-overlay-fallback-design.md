---
title: Audit session/honest — overlay fallback
date: 2026-07-03
status: approved
risk: MEDIUM
scope: mega audit session + honest read overlay stats when no registered session
base: main
reviewers: [code-reviewer, critic]
---

# Audit session/honest — overlay fallback

## Problem (root-caused via systematic-debugging)

MegaSaver has TWO session-stats models:

- **Overlay** (`stats/<workspaceKey>/<liveSessionId>.json` +`.events.jsonl`) —
  written by the token-saver **hook** (`mega hooks saver` →
  `recordAndFilterOverlayOutput` → `appendOverlayEvent`). This is what runs in
  a normal Claude Code session and what the GUI token-saver panel reads
  (`OverlaySessionTokenSaverStats`).
- **Registered** (core registry session + `stats/<projectId>/<sessionId>.audit.jsonl`)
  — written by the proxy/registered-session path, read by
  `mega audit session|honest|report`.

`mega audit session <id>` / `honest <id>` call `registry.getSession(id)`
(`session.ts:42`); for a hook/overlay live-session id this returns `null` →
`sessionNotFoundMessage` → "session not found", **even though correct overlay
stats exist on disk**. `mega audit usage` already bridges to the overlay model;
`session`/`honest` do not. That inconsistency is the bug.

Verified: this machine's live session `1af7f8f0-…` has a real overlay summary
(`eventsTotal:5, bytesSavedTotal:73493, savingRatio:0.811`) yet
`mega audit session 1af7f8f0-…` returns "session not found".

## Fix

In `runAuditSession` and `runAuditHonest`, when `registry.getSession(id)`
returns `null`, fall back to the overlay model instead of erroring:

1. Look up the overlay summary for `id` across workspaces (the command only
   receives a session id, not a workspaceKey).
2. If found → render an overlay stats card (and `--json` emits the
   `OverlaySessionTokenSaverStats`), clearly labelled as a live/token-saver
   (overlay) session so it isn't confused with a registered audit summary.
3. If neither a registered session nor an overlay summary exists → keep the
   existing "session not found" behaviour unchanged.

A registered session still takes precedence (only fall back when
`getSession` is null), so existing behaviour is untouched for proxy sessions.

## New helper (`@megasaver/stats`)

`readOverlaySummaryAnyWorkspace(store, liveSessionId):
{ workspaceKey: string; summary: OverlaySessionTokenSaverStats } | null`

- Lists the `stats/` directory, and for each workspaceKey segment reads
  `stats/<wk>/<liveSessionId>.json` via the existing `readOverlaySummary`.
- Returns the first match in **sorted** workspaceKey order (deterministic).
  Returns `null` if none / no `stats/` dir. Best-effort: a corrupt/missing
  file for one workspace is skipped, not fatal.
- (Live-session ids are UUIDs; a collision across workspaces is
  vanishingly unlikely — first sorted match is a fine, deterministic rule.)

## Locked decisions

- **Scope: `session` + `honest` only.** `report` is project-scoped
  (`PROJECTNAME`, registered model); overlay is workspaceKey-scoped — a
  different shape, deferred (documented non-goal).
- **workspaceKey resolution: scan-all-workspaces** (not a new `--cwd`/`--workspace`
  flag) — keeps the "just give an id" UX identical to today.
- **Overlay card is visually distinct** and labelled `live token-saver
  session (overlay stats)` so a user knows it's not registered-audit data.
- **Fallback `--json` carries a `source: "overlay"` discriminator** so a
  machine consumer can tell it from the registered summary shape.
- **`honest` validates its session-id positional** the same way `session`
  does (reject a malformed/non-lowercase id with an explicit error, not a
  silent all-zeros report).
- Fallback fires **only** when `getSession` is null.

## Testing (TDD, non-tautological)

- `runAuditSession` over a store with ONLY an overlay summary for id X (no
  registered session) → exit 0, output shows the overlay bytes/ratio/events,
  NOT "session not found". Mutation: removing the fallback → test fails with
  not-found (this is the whole fix).
- Same for `runAuditHonest`.
- Registered session present → unchanged registered card (fallback not taken).
- Neither present → "session not found" preserved (exit code unchanged).
- `--json` on the overlay path emits the `OverlaySessionTokenSaverStats`.
- `readOverlaySummaryAnyWorkspace`: finds across workspaces; deterministic on
  multiple; null on none; skips a corrupt workspace file.

`pnpm verify` green; changeset (`@megasaver/cli` minor, `@megasaver/stats`
minor). code-reviewer + critic before PR.

## Non-goals

`mega audit report` overlay support; merging overlay + registered into one
view; deriving workspaceKey from cwd; any change to the hook write path (it is
correct).
