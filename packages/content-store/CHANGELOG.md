# @megasaver/content-store

## 1.1.2

### Patch Changes

- Updated dependencies [20977aa]
  - @megasaver/output-filter@1.4.0

## 1.1.1

### Patch Changes

- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
- Updated dependencies [4269f42]
  - @megasaver/shared@1.2.0
  - @megasaver/output-filter@1.3.0

## 1.1.0

### Minor Changes

- c12a575: Add per-session already-in-context dedup to the registry read pipeline.
  When `runOutputPipeline` is about to return an excerpt whose exact text
  was already shown earlier this session (recorded in a new sibling
  `shown-index.json`), the excerpt is dropped from the inline result and
  referenced via its prior chunk-set id instead — so identical text is not
  billed twice. Dedup runs after the chunk-set is persisted, so every
  suppressed excerpt remains recoverable via the referenced chunk-set
  (evidence-preserving). Adds an optional `deduped` field to
  `FilterOutputResult` and a `SHOWN_INDEX_FILENAME` constant to
  content-store (skipped when listing chunk-sets).
- c12a575: feat: per-session already-in-context dedup

  Suppress an excerpt whose exact text was already returned to the model
  earlier in the same session (any read, command, or grep) and reference the
  prior chunk-set instead, so identical text is not billed twice. New
  per-session shown-index.json sibling index; evidence stays recoverable via
  the referenced chunk-set (lossless expand).

- 46dce69: diff-on-reread (suppression-only): re-reading an unchanged file in the same
  session returns an `unchanged: { priorChunkSetId }` marker with empty
  excerpts and skips re-filtering + re-persisting. Lossless — the prior
  chunk-set is recoverable via expand. Adds FilterOutputResult.unchanged +
  unchanged-marker decision (output-filter); readRaw / filterRaw / read-index
  exports (context-gate); exports atomicWriteFile + read-index-tolerant
  listChunkSets / READ_INDEX_FILENAME (content-store).

  No @megasaver/daemon or @megasaver/mcp-bridge bump — passthrough only,
  confirmed by T11.

- fde8e86: Live-first Phase 4: session-scoped overlay surface keyed by
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

### Patch Changes

- 7fcd881: atomicWriteFile no longer reports a failure when the post-rename
  parent-directory fsync throws. Once the rename commits, the file is
  written; the directory fsync is a durability hint, not a correctness
  gate. Prevents spurious write_failed errors that could trigger
  double-writes in caller retry logic.
- Updated dependencies [7fcd881]
- Updated dependencies [c12a575]
- Updated dependencies [c12a575]
- Updated dependencies [66ac31e]
- Updated dependencies [66ae179]
- Updated dependencies [8580701]
- Updated dependencies [46dce69]
- Updated dependencies [42207dd]
- Updated dependencies [ede092b]
- Updated dependencies [fde8e86]
- Updated dependencies [4be82f8]
- Updated dependencies [b1978fa]
- Updated dependencies [3b1cf6e]
- Updated dependencies [f7cbc28]
- Updated dependencies [12c8e9e]
- Updated dependencies [f7bb136]
- Updated dependencies [ed46198]
- Updated dependencies [00bd97e]
- Updated dependencies [8b735fb]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [5431672]
- Updated dependencies [ede092b]
- Updated dependencies [3a6ed28]
- Updated dependencies [41751db]
- Updated dependencies [489d4ac]
- Updated dependencies [01c10f0]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
  - @megasaver/output-filter@1.2.0

## 1.0.1

### Patch Changes

- Updated dependencies [7b978d3]
- Updated dependencies [19def67]
  - @megasaver/output-filter@1.1.0

## 1.0.0

### Major Changes

- b7f35e3: Mega Saver v1.0 — Context Gate / Mega Saver Mode.

  Session-scoped, GUI-controlled, MCP-backed output compression ships
  complete: the `tokenSaver` session setting, the Context Gate
  orchestrator, the output-filter redaction/ranking pipeline, the
  content store, retrieval (BM25) and stats packages, the real
  `@megasaver/mcp-bridge` over stdio with four tools, the GUI
  TokenSaverPanel + Agent Setup Doctor, and the additive
  `MEGA SAVER:CONTEXT_GATE` connector instruction block. One click
  enables token saving per session; raw evidence stays local; the agent
  receives only the most relevant excerpts with measurable byte savings.

### Minor Changes

- a8b6531: Add the `@megasaver/content-store` package: ChunkSet persistence for
  the context-gate pipeline. Stores one JSON file per chunkSet under
  `<storeRoot>/content/<projectId>/<sessionId>/<chunkSetId>.json` with an
  in-package atomic write (temp + fsync + rename, POSIX dir-fsync,
  symlinked-parent refusal). Public surface: `saveChunkSet`,
  `loadChunkSet`, `listChunkSets`, `deleteChunkSet`, and an injected-clock
  `pruneOlderThan`, plus the `chunkSet`/`chunk` Zod schemas and a closed
  `contentStoreErrorCodeSchema` enum. The store root is injected by the
  caller; content-store never imports `@megasaver/core` (cycle guardrail).
  The `redacted` flag is persisted verbatim and round-trips intact.

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [ae41534]
- Updated dependencies [b7f35e3]
- Updated dependencies [0498b79]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/output-filter@1.0.0
