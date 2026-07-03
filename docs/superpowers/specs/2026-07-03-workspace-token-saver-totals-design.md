---
title: GUI — workspace token-saver totals (fix fragmented empty panel)
date: 2026-07-03
status: approved
risk: MEDIUM
scope: aggregate overlay savings across a workspace's sessions; GUI panel shows workspace total when the per-session id is empty
base: main
reviewers: [code-reviewer, critic]
---

# GUI — workspace token-saver totals

## Problem (verified visually + via network)

The GUI token-saver panel (`token-saver-panel.tsx`) fetches
`/api/claude-sessions/<dir>/<id>/token-saver/stats` → per-**session** overlay
summary (`stats/<workspaceKey>/<liveSessionId>.json`). When that id has no
summary it renders "No proxy activity recorded for this session."

Overlay stats are keyed by Claude's `session_id`, which **rotates** across
restarts/compaction — one logical conversation scatters across many session-id
files (this workspace: 8+ ids, several MB saved: e.g. `3caec427` 1.89 MB,
`4bac6b33` 2.34 MB). Confirmed by driving the live GUI: the panel queries
`ecfddf10-…` (the current id) → HTTP 200 with **null** body (no summary for that
id) → empty panel, even though the workspace has saved MBs under other ids.

So a per-single-session view is structurally misleading under id rotation. The
fix is to surface the **workspace total** (all sessions) so the panel reflects
real savings.

## Fix

1. **Aggregate** — new `@megasaver/stats` function summing every session
   summary under a workspaceKey.
2. **Bridge endpoint** — `GET .../token-saver/workspace-stats` returns the
   totals (or null when the workspace has no summaries).
3. **Panel** — when the per-session `stats` is null, fetch and render the
   **workspace total** card (clearly labelled "workspace total — N sessions").
   Only when BOTH the session and the workspace have nothing show an accurate
   empty message: **"No token-saver activity in this workspace yet."** (this
   also retires the misleading "No proxy activity" copy).

Per-session data, when present, is unchanged (still shown as the session card).

## New helper (`@megasaver/stats`)

`readWorkspaceTokenSaverTotals(store: StatsStore, workspaceKey: string):
WorkspaceTokenSaverTotals | null`

```
WorkspaceTokenSaverTotals = {
  workspaceKey: string
  sessionsCount: number
  eventsTotal, rawBytesTotal, returnedBytesTotal, bytesSavedTotal: number
  savingRatio: number            // bytesSavedTotal / rawBytesTotal (0 if raw 0)
  secretsRedactedTotal, chunksStoredTotal: number
  latestUpdatedAt: string | null // max updatedAt across summaries
}
```

- Lists `stats/<workspaceKey>/`; for each `*.json` entry, parse with the
  overlay-summary schema and **keep only valid session summaries** — this
  naturally excludes `*.settings.json`, `workspace-token-saver.json`,
  `session-intent.json` (they fail the summary schema) and `*.events.jsonl`
  (not `.json`). Sum the valid ones.
- `null` when the dir is missing or no valid summary exists. Best-effort: a
  corrupt file is skipped, never fatal.
- Reuse the existing summary schema / `readOverlaySummary` load path so the
  field set stays in lockstep.

## Bridge + client

- Route `handleWorkspaceTokenSaverStats(ctx, dir, id)` in
  `apps/gui/bridge/routes/claude-session-token-saver.ts`: resolve the
  workspaceKey via the existing `resolveSessionWorkspace`, call
  `readWorkspaceTokenSaverTotals({ root: ctx.storeRoot }, wk)`, send JSON (or
  `null`). Register it beside the existing `/token-saver/stats` route in the
  handler table.
- Client `fetchWorkspaceTokenSaverStats(dir, id): Promise<WorkspaceTokenSaverTotals | null>`
  in `claude-sessions-client.ts`, plus the exported type.

## Locked decisions

- **Aggregation is schema-validated** (not a filename glob) — robust against
  settings/intent sibling files.
- **Workspace-scoped, not conversation-scoped**: we do NOT try to map a
  conversation's specific rotated ids (that mapping isn't tracked); workspace
  total is the meaningful, available number.
- **Fallback, not replacement**: per-session card still shows when the id has
  data; workspace total shows when it doesn't. (A "workspace total" line could
  later be shown always — deferred.)
- Fix the empty-state copy as part of this change.

## Testing (TDD, non-tautological)

- `readWorkspaceTokenSaverTotals`: a wk dir with 3 session summaries + a
  `*.settings.json` + a `workspace-token-saver.json` → totals sum ONLY the 3
  summaries, `sessionsCount === 3`, ratio recomputed, latestUpdatedAt = max;
  no summaries / missing dir → null; a corrupt summary file is skipped and the
  rest still sum. Mutation: including settings files would break the
  count/bytes assertion.
- Bridge route: returns the totals JSON for a workspace with summaries; null
  when none; workspaceKey resolved from dir.
- Panel (component test / bridge test as the repo does GUI tests): session
  stats null + workspace totals present → renders the workspace-total card
  (not the "No activity" message); both null → the new accurate empty message.
- `pnpm verify` green; smoke: drive the built bridge against the real store and
  confirm `.../token-saver/workspace-stats` for `e02b98f66e82b6b9` returns the
  multi-MB total.

## Non-goals

Conversation→session-id mapping; changing how the hook keys stats (per-id is
correct at the write layer); a global cross-workspace total; the `mega audit`
CLI (already handled in #220).
