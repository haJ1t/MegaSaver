---
title: Plan — scope chunk-set deletion and holds by (workspaceKey, sessionRef)
spec: docs/superpowers/specs/2026-07-25-evgc-content-id-collision-design.md
risk: CRITICAL
created: 2026-07-25
branch: fix/evgc-content-id-collision
base: origin/main
---

# Plan — evidence GC content-id collision

Rule for every task below: the RED step must be **run and its failure output
pasted into the task's evidence** before a line of implementation is written
(CLAUDE.md §4.3). "It would fail" is not a red proof.

## Task 1 — RED: the delete path deletes the wrong file

New `packages/context-gate/test/evidence-gc-id-collision.test.ts`, driving the
real exports in `maybeRunOverlayGc` order. Two `recordAndFilterOverlayOutput`
calls with the **same raw**, same `workspaceKey`, sessions
`old-session` (`now` → 40 days ago) and `live-session`, both under the saver's
own id generator (content-derived, so both land on one `cs-<sha256[0:32]>`).

Assertions (all four in one file — they are the two directions the fix must
prove):

1. `sweepEvidenceStore` removes `content/<wk>/old-session/<id>.json`.
2. `content/<wk>/live-session/<id>.json` still exists.
3. `fetchChunk` for the live set returns `ok:true`.
4. The old record ends `retained_metadata_only`; the live record stays
   `available`.

Plus a cross-workspace case (spec §2 C1): repo A's sweep leaves repo B's file.

**Red proof**: assertions 2/3 fail today (`expected false to be true`,
`{"ok":false,"reason":"chunk_set_not_found"}`). Assertion 1 may pass or fail
depending on `readdir` order — pin the order-dependence by asserting both files'
state, never just one.

## Task 2 — GREEN: carry the scope through the port

1. `packages/evidence-ledger/src/ports.ts` — `ChunkRef { workspaceKey,
   sessionRef, chunkSetId }`; `ChunkDeletePort = (ref: ChunkRef) => Promise<void>`.
   Export both from `src/index.ts`.
2. `packages/evidence-ledger/src/store.ts:239` (`revokeEvidence`) and `:303`
   (`gcEvidence`) — pass `{ workspaceKey: rec.workspaceKey, sessionRef:
   rec.sessionRef, chunkSetId: rec.redactedRawChunkSetId }`.
3. `packages/context-gate/src/evidence-gc.ts` — `deleteChunk` takes the ref,
   drops the `locateChunkSet` import, deletes at
   `deleteOverlayChunkSet({ storeRoot, workspaceKey: ref.workspaceKey,
   liveSessionId: ref.sessionRef.id, chunkSetId })` only when
   `ref.sessionRef?.kind === "live"`; otherwise no-op (matches today's
   non-overlay early return — fail closed).
4. Update the port's callers in tests
   (`evidence-ledger/test/store.test.ts`, `context-gate/test/record-output-evidence.test.ts`).

**Green proof**: Task 1 file passes; `pnpm --filter @megasaver/evidence-ledger test`
and `--filter @megasaver/context-gate test` green.

## Task 3 — RED: the pin walker over-retains across scopes

New case in `packages/context-gate/test/retention-prune.test.ts` (spec §2 C2):
workspace A record **pinned**, workspace B record unpinned and expired, both on
the same content-derived id. Assert after `pruneChunkSetsHonoringPins`:
A's file kept, **B's file removed**.

**Red proof**: B's file is still present today (`expected true to be false`) —
and this case does not touch `locateChunkSet`, so it must be red *after* Task 2
is green. That ordering is the evidence that Task 2 alone was insufficient.

## Task 4 — GREEN: key the hold set by the same triple

1. `packages/content-store/src/store.ts` — export
   `chunkSetKey({ topDir, sessionDir, chunkSetId }): string` (`/`-joined);
   rename `pruneOlderThan`'s `keepChunkSetIds` → `keepChunkSetKeys`; the walk
   keeps a file when `keepChunkSetKeys.has(chunkSetKey(...))` **or**
   `keepChunkSetKeys.has(bareId)` (fail-open for an unscopable hold, spec §4.4).
   Re-export `chunkSetKey` from `src/index.ts`.
2. `packages/context-gate/src/retention-prune.ts` — `heldChunkSetIds` →
   `heldChunkSetKeys`: emit `chunkSetKey({ topDir: rec.workspaceKey,
   sessionDir: rec.sessionRef.id, chunkSetId })` for `{kind:"live"}` refs, the
   bare id otherwise.

**Green proof**: Task 3 case passes; existing `retention-prune.test.ts`,
`content-store/test/prune-overlay.test.ts`, `prune-scan-cost.test.ts`,
`store.test.ts`, `shown-index-skip.test.ts` all still green (prune must still
collect ordinary expired sets — "deletes nothing" is not a fix).

## Task 5 — the false invariant and its fence

1. `packages/context-gate/src/locate-chunk-set.ts:14` — replace *"Chunk-set ids
   are globally unique (§3d), so the first match owns it"* with the real
   invariant: ids may collide across sessions since `cdf5fd54`; colliding sets
   are byte-identical by construction so any match serves a **read**; never use
   this to resolve a delete.
2. Guard test (shape of `packages/context-gate/test/dependency-direction.test.ts`):
   `evidence-gc.ts` and `retention-prune.ts` sources contain no `locateChunkSet`
   reference.

**Red proof**: write the guard test before step 1 is committed alongside Task 2 —
run it on `origin/main`'s `evidence-gc.ts` and capture the failure.

## Task 6 — release + memory

- `.changeset/evgc-content-id-collision.md` — patch for
  `@megasaver/evidence-ledger`, `@megasaver/content-store`,
  `@megasaver/context-gate` (public surfaces change: `ChunkDeletePort`,
  `pruneOlderThan` param, new `chunkSetKey`). No compat shim, pre-1.0 (§13).
- `wiki/`: new `concepts/chunk-set-identity.md` — the triple is the address, the
  id alone is not; the three consumers; why content-derived ids stay. Link it
  from `wiki/index.md`. Append a timestamped `wiki/log.md` entry.
  Rebase before touching `wiki/log.md` — other sessions write it.

## Task 7 — verification, then review

1. `pnpm verify` at repo root, full output captured. No "fixed"/"passing" claim
   before it is green (§9).
2. Re-run the spec §2 repro scripts A, B, C against the **built** packages;
   both directions must flip: expired collected, live survives, C2 pruned.
3. Reviews in fresh contexts, author ≠ reviewer: `code-reviewer`, `critic`,
   `security-reviewer` (CRITICAL, spec §8). Then `verifier` with the §2 evidence.
4. No unsupervised loops. No working-tree git commands outside this worktree.
