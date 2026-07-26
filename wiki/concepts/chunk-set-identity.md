---
title: Chunk-Set Identity — the triple is the address, the id is not
tags: [concept, context-gate, content-store, evidence-ledger, critical-risk]
sources: [docs/superpowers/specs/2026-07-25-evgc-content-id-collision-design.md, docs/superpowers/plans/2026-07-25-evgc-content-id-collision-plan.md]
status: active
created: 2026-07-26
updated: 2026-07-26
---

## The invariant

A stored chunk file is addressed by the **triple**
`(workspaceKey, session dir, chunkSetId)` — its path is
`<store>/content/<workspaceKey>/<liveSessionId>/<chunkSetId>.json`
(code: packages/content-store/src/paths.ts). The id alone is **not** a key.

The saver derives the id from content: `` cs-${sha256(raw).slice(0,32)} ``
(code: apps/cli/src/hooks/saver.ts:350; the daemon rebuilds the same id at
packages/daemon/src/handlers.ts because a hook cannot ship a closure over HTTP).
Two sessions that emit byte-identical output therefore write the **same
filename** in two different directories. That collision is deliberate — the
first-sight saver dedupe ([[diff-on-reread]], `saver-seen.ts`) is built on it —
but it voided an older "ids are globally unique" assumption that three consumers
still relied on.

## The three consumers, and what each may key on

| path | may key on | why |
|---|---|---|
| READ (`fetchChunk` → `locateChunkSet`) | bare id | colliding sets are byte-identical (id = sha256 of the pre-redaction raw, redaction deterministic), so any match answers a read |
| DELETE (`gcEvidence` → `ChunkDeletePort` → `deleteOverlayChunkSet`) | the triple, always — **plus a last-reference check** | deleting the wrong copy destroys a live session's evidence; deleting the right *file* on behalf of one of its owners destroys the others' |
| HOLD (`pruneChunkSetsHonoringPins` → `pruneOlderThan`) | the triple, always | a hold keyed by bare id retains every workspace's copy forever |

`locateChunkSet` is a store-wide **first-match** scan. It is a read helper only;
a guard test forbids `evidence-gc.ts` and `retention-prune.ts` from importing it
(test: packages/context-gate/test/evidence-gc-id-collision.test.ts).

## The triple is the address, not the owner

One file can have several owners *inside one session*: the saver's first-sight
index (`saver-seen.ts`) fails open three ways — `SEEN_CAP = 500` FIFO eviction,
a skipped write under `withFileLock(deadlineMs: 50)`, and `readHashes` returning
`[]` on a parse anomaly — and each leaves the evidence row written with the hash
unrecorded, so a re-run of the same output writes a second record at the same
triple. Scoping the delete to the triple therefore narrows it to the right
*file*, which is necessary but not sufficient.

`gcEvidence` closes the gap with the ownership test: it already holds every
record in the workspace, so it precomputes the addresses of the records that
survive this pass (`available` and not being collected — pinned and manual_hold
are never collected) and skips the unlink when the expiring record's address is
in that set. The record is still degraded to `retained_metadata_only`; only the
`unlink` is withheld (code: packages/evidence-ledger/src/store.ts `chunkAddress`
/ `stillReferenced`; tests: packages/context-gate/test/evidence-gc-id-collision
.test.ts, packages/evidence-ledger/test/store.test.ts).

`revokeEvidence` deliberately keeps deleting unconditionally: a revoke is a
requested destruction of that content, not housekeeping, so a twin losing its
raw is the intended outcome.

## Fail directions are opposite on purpose

- **Delete fails closed.** `ChunkDeletePort` takes
  `ChunkRef { workspaceKey, sessionRef, chunkSetId }`; a ref whose session scope
  is unresolvable is a no-op. Never delete on a guess.
- **Hold fails open.** An unscopable hold is emitted as a bare id and
  `pruneOlderThan` keeps every match. Over-retaining is recoverable; deleting a
  pinned chunk is not. Scoped keys (`chunkSetKey`) contain `/`; ids never do, so
  the two forms cannot be confused.

## Why the ids stay content-derived

Re-salting the id with workspace/session would restore uniqueness but breaks the
saver dedupe and `diff-on-reread`, and does nothing for the colliding files
already on disk in every existing store (spec §5). The key was the bug, not the
id.
