---
"@megasaver/gui": minor
---

Live-first Phase 0 — surface per-turn telemetry the live Claude Code
transcript already carries, read-only and additive, without touching the
project model.

**parse**: `normalizeLine` now retains an optional `meta` (`model`,
`usage`, `gitBranch`) on `NormalizedMessage`, omitted entirely when the
line has no signal — existing `{ role, ts, blocks }` consumers (transcript
renderer, SSE) are byte-for-byte unchanged.

**reader**: `readSessionTitles` additionally reads `isArchived`, `model`,
`permissionMode` from `local_*.json`; `ClaudeSessionMeta` gains those plus
the already-read `lastActivityAt`, each type-guarded with a safe default.

**telemetry**: new pure `aggregateTelemetry(messages)` → token totals,
model mix (turn-desc), turn/tool-call counts, duration, and git branch.

**endpoint**: `GET /api/claude-sessions/:dir/:id/telemetry` returns the
aggregate, mirroring the snapshot route's 400/404/405/500 envelopes and
the identical `safeSessionPath` traversal guard.

**GUI**: a read-only telemetry panel (LLM context tokens — distinct from
the token-saver proxy metric), an archived filter (default hide), and
`model`/archived row badges in the sessions view.
