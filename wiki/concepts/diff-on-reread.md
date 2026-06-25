---
title: Diff-on-Reread (Unchanged-Read Suppression)
tags: [concept, context-gate, token-efficiency, high-risk]
sources: [docs/superpowers/specs/2026-06-25-diff-on-reread-design.md, docs/superpowers/plans/2026-06-25-diff-on-reread.md]
status: active
created: 2026-06-26
updated: 2026-06-26
---

## Problem

Re-reading the same unchanged file in one session re-spends tokens: the read
pipeline re-filters, re-persists, and re-returns content the agent already saw
(spec: docs/superpowers/specs/2026-06-25-diff-on-reread-design.md). Risk: HIGH
(touches the [[context-gate-pipeline]] core read path at scale).

## Mechanism

On a read, the pipeline reads raw bytes, computes `sha256` of the content, and
looks up an on-disk per-session **read-index** keyed by `sha256(absolutePath)`
(code: packages/context-gate/src/read-index.ts — `hashContent`, `hashPath`,
`loadReadIndex`, `recordRead`). The index value is `{ contentHash, chunkSetId }`.

- **Hit + content hash matches** → return a tiny `FilterOutputResult.unchanged
  = { priorChunkSetId }` (decision `"unchanged-marker"`, empty excerpts); SKIP
  filter + SKIP persist (code: packages/context-gate/src/run.ts —
  `unchangedResult`).
- **Miss / hash differs** → filter + persist the chunk-set as today, THEN record
  the read-index entry (recorded only AFTER successful persist, so
  `priorChunkSetId` always resolves) (PR #181).

This required splitting `readAndFilter` into `readRaw` + `filterRaw` (thin
wrapper kept) so the hash is computed before filtering (code:
packages/context-gate/src/read.ts; PR #181).

## Both pipeline variants

Both short-circuit: `runOutputPipeline` (registry: projectId/sessionId) and
`runOverlayOutputPipeline` (overlay: workspaceKey/liveSessionId). Each session
gets its own `read-index.json` in the same content dir as its chunk-sets (PR #181).

## Lossless

Suppression is LOSSLESS — the prior chunk-set is still on disk and expandable;
the marker just points at `priorChunkSetId` instead of re-returning content (PR #181).

## v1 scope

Suppress-only (no diff hunks), `sha256` hash (mtime fast-path deferred),
path-HASH key (no raw paths on disk, matches the [[content-store]] redaction
posture), atomic index write via exported `atomicWriteFile`. `listChunkSets` /
`pruneOlderThan` skip the reserved `READ_INDEX_FILENAME` (code:
packages/content-store/src/store.ts; PR #181).

## Known gap

Suppressed reads are not metered in token-saver stats (deferred) (PR #181).

See [[context-gate]], [[output-filter]], [[content-store]], [[context-gate-pipeline]].
