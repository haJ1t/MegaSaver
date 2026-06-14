---
"@megasaver/core": minor
"@megasaver/stats": minor
"@megasaver/content-store": minor
"@megasaver/context-gate": minor
---

Live-first Phase 4: session-scoped overlay surface keyed by
`(workspaceKey, liveSessionId)` instead of `(projectId, sessionId)`.

Adds, alongside the existing project-keyed APIs (kept for Phase 5):

- `@megasaver/core`: `overlay-key` types (`workspaceKeySchema`,
  `liveSessionIdSchema`, `isSafeKeySegment`), `overlayMemoryEntrySchema`
  (scope-split: `project` = workspace/cwd-scoped, `session` = conversation),
  `overlayTaskPlanSchema`, and the overlay store fns
  (`read/writeOverlayMemory`, `read/writeOverlayTaskPlans`).
- `@megasaver/stats`: `overlayTokenSaverEventSchema`,
  `overlaySessionTokenSaverStatsSchema`, and the overlay store fns
  (`appendOverlayEvent`, `readOverlaySummary`, `readOverlayEvents`,
  `resetOverlayOnDisable`).
- `@megasaver/content-store`: `overlayChunkSetSchema` plus
  `saveOverlayChunkSet`/`loadOverlayChunkSet` for the
  `content/<workspaceKey>/<liveSessionId>/<chunkSetId>.json` layout.
- `@megasaver/context-gate`: `runOverlayOutputPipeline`,
  `runOverlayOutputExecCommand`, and `resolveOverlayEffectiveSettings`
  — the proxy pipeline re-keyed off the live session (no registry
  lookup), emitting events/chunks under the overlay keys.
