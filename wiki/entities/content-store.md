---
title: '@megasaver/content-store'
tags: [entity, package, content-store, persistence, v0.5, aa1]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
  - docs/superpowers/specs/2026-06-25-diff-on-reread-design.md
status: active
created: 2026-05-11
updated: 2026-06-26
---

# `@megasaver/content-store`

ChunkSet persistence for the Context Gate pipeline. Raw filtered
output is stored locally as a chunk set so the agent can drill into
an excerpt without re-reading the whole file. Shipped BB4 (PR #72,
`a8b6531`). Risk MEDIUM.

## On-disk layout

```
<store>/content/<projectId>/<sessionId>/<chunkSetId>.json
```

The `<store>` root is passed in by the caller (the same root core's
`resolveStorePaths` would yield); content-store never resolves it
itself — that would require importing core (forbidden, see below).

## Public surface (`packages/content-store/src/index.ts`)

- `saveChunkSet({ storeRoot, chunkSet }): Promise<void>` (`src/store.ts`).
- `loadChunkSet(...): Promise<ChunkSet>` — throws
  `ContentStoreError("not_found")` on miss.
- `listChunkSets(...): Promise<readonly ChunkSetSummary[]>`.
- `deleteChunkSet(...): Promise<void>`.
- `pruneOlderThan({ storeRoot, olderThan }): Promise<{ removed }>` —
  caller passes an explicit clock (no module-level `Date.now()`).
- `chunkSchema` / `Chunk`, `chunkSetSchema` / `ChunkSet`,
  `ChunkSetSummary` (`src/chunk-set.ts`). `ChunkSet.source` is a
  discriminated union keyed on `OutputSourceKind` imported from
  `@megasaver/output-filter` (§10d). The `redacted` boolean carries
  the F-MAJ-3 invariant: a chunkSet from a session with
  `redactSecrets === true` must be `true`.
- `ContentStoreError` + `contentStoreErrorCodeSchema`
  (`src/errors.ts`) — 4 members alphabetic (AA3): `not_found`,
  `schema_invalid`, `store_corrupt`, `write_failed`.

## Cycle fix — no core edge (§3c, locked)

content-store does NOT import `@megasaver/core`. Its atomic write is
implemented in-package (`src/atomic-write.ts`, ≈ 50 LOC mirroring
`json-directory-store.ts` semantics — POSIX dir-fsync, win32-aware)
precisely so the `content-store → core` edge never closes. The bounded
duplication is the accepted cost. See
[[decisions/content-store-no-core-edge]]. Dependencies:
`@megasaver/shared` + `@megasaver/output-filter` only; a
`dependency-graph.test.ts` fails on any core import.

## Read-index sibling (diff-on-reread, PR #181)

`atomicWriteFile` is now part of the public surface (`src/index.ts`,
PR #181) so [[context-gate]]'s read-index module can reuse it for atomic
index writes. `READ_INDEX_FILENAME = "read-index.json"` is exported
(code: packages/content-store/src/store.ts:20) — a reserved per-session
sibling of the chunk-set files. `listChunkSets` and `pruneOlderThan`
skip it by name so it is never mistaken for a chunk-set
(code: packages/content-store/src/store.ts:119,244). content-store owns
the constant + atomic primitive only; the index's contents/lookup live
in context-gate. See [[diff-on-reread]].

## Retention

Default 7 days from `createdAt`; daily prune via lockfile pattern
(BB4 ships the mechanism; user-visible control deferred to v0.8 GUI).

## Related

- [[entities/output-filter]] — produces the chunks; owns
  `OutputSourceKind`.
- [[decisions/content-store-no-core-edge]] — the §3c lock.
- [[entities/cli]] — `mega output {file,filter,chunk}` reads/writes here.
- [[concepts/context-gate-pipeline]] — where persistence sits.
