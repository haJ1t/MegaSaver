---
title: Evidence GC deletes a live session's chunk set (content-derived id collision)
status: proposed
risk: CRITICAL
created: 2026-07-25
packages:
  - "@megasaver/context-gate"
  - "@megasaver/evidence-ledger"
  - "@megasaver/content-store"
found-by: security sweep sec3, entry `evidence-gc-content-id-collision`; reproduced
  independently against origin/main `133a95f0` (defect path byte-identical at `07a4e3dc`)
---

# Evidence GC resolves "which file" by a key that is no longer unique

> CRITICAL per CLAUDE.md §12 — this deletes user data, unattended, with no
> user action, on a daily throttle inside the PostToolUse saver hook.

## §1 The defect

Chunk-set ids stopped being unique and the delete path never noticed.

Three ingredients, all on `main`:

1. `locateChunkSet` (`packages/context-gate/src/locate-chunk-set.ts:14`) scans
   `<store>/content/<topDir>/<sessionDir>/` store-wide and returns the **first**
   match, on the documented assumption *"Chunk-set ids are globally unique
   (§3d), so the first match owns it"*. True when it was written (`a2526d3a`):
   ids were `randomUUID`.
2. `cdf5fd54` made the saver derive ids from content —
   `apps/cli/src/hooks/saver.ts:350`, `` newId: () => `cs-${sha256(raw).slice(0,32)}` ``,
   no session or workspace salt. Two sessions that produce byte-identical output
   now write the **same filename** in two different session directories. The
   daemon path rebuilds the same id (`packages/daemon/src/handlers.ts:36,55`)
   because the hook cannot ship a closure over HTTP
   (`apps/cli/src/hooks/saver-run.ts:121`). That collision is by design — it is
   what the first-sight saver dedupe is built on — but it silently voided the
   §3d invariant.
3. `07a4e3dc` added `sweepEvidenceStore`
   (`packages/context-gate/src/evidence-gc.ts`, new file) and wired the
   evidence ledger's `deleteChunk` port to that store-wide scan for the first
   time. That commit turned a stale comment into a data-loss bug.

The root cause is not the scan. It is the **key**: the deleting code identifies
a chunk file by a bare `chunkSetId`, while a chunk file is actually addressed by
the triple `(workspaceKey, sessionDir, chunkSetId)`. Every consumer that throws
the first two components away inherits the bug.

The choke point is one line — `packages/evidence-ledger/src/ports.ts:4`:

```ts
export type ChunkDeletePort = (chunkSetId: string) => Promise<void>;
```

The record at `packages/evidence-ledger/src/store.ts:290` already carries
`rec.workspaceKey` (schema.ts:28) and `rec.sessionRef` (schema.ts:29, written by
`record-output.ts:307` as `{ kind: "live", id: liveSessionId }`), and
`deleteOverlayChunkSet({ storeRoot, workspaceKey, liveSessionId, chunkSetId })`
(`content-store/src/store.ts:153`) already **accepts** the full triple. The port
signature is the only thing discarding the scope.

## §2 Reproduction (independent, against origin/main `133a95f0`)

Three scripts driving the real exported entry points in the exact order
`apps/cli/src/hooks/gc.ts maybeRunOverlayGc` uses —
`recordAndFilterOverlayOutput` → `pruneChunkSetsHonoringPins` →
`sweepEvidenceStore` → `fetchChunk` — with the verbatim saver id generator.

### A — both copies present, prune collects neither

```
shared chunkSetId: cs-f9674fb1c8270565a7ed302b31d2dbb9 == cs-f9674fb1c8270565a7ed302b31d2dbb9
before GC:             old=true  live=true
after prune:           old=true  live=true
after evidence sweep:  old=true  live=false
ledger: live-session-right-now       status=available              rawChunkSetId=cs-f967…
ledger: old-session-from-last-month  status=retained_metadata_only rawChunkSetId=null
```

`readdir` order picked the LIVE directory. The live session's raw output is
deleted; the **expired** one survives. The expired record is now
`retained_metadata_only` with a null pointer, so `store.ts:291/301` skips it on
every future sweep — its raw bytes are stranded on disk forever. `fetchChunk`
returns `ok:true` only because it silently falls through to the surviving
foreign copy, which is what makes the deletion invisible.

### B — the reported primary case (old file's mtime aged to 40d)

```
after prune:           old=false live=true
after evidence sweep:  old=false live=false
live `mega output chunk` -> {"ok":false,"reason":"chunk_set_not_found"}
ledger: live-session-right-now  status=available  rawChunkSetId=cs-f967…
```

Prune correctly removes the expired copy; the sweep then finds only the LIVE
copy and deletes that too. The live session's ledger row still says
`status=available`, i.e. the ledger now lies about recoverability, and the
recovery footer handed to the model
(`mega output chunk "cs-f967…" "<i>"`) is unredeemable.

### C — it crosses workspaces, and the sibling walker fails the other way

```
C1 cross-workspace
  after sweep:  repoA=false repoB=false   <- repo B's LIVE chunk deleted by repo A's GC

C2 pin-set keyed by bare id
  after prune:  repoA(pinned)=true repoB(unpinned,expired)=true
                                          <- repo B over-retained by repo A's pin
```

C2 never calls `locateChunkSet`. `pruneChunkSetsHonoringPins`
(`retention-prune.ts:15-34`) builds a `Set<string>` of bare
`rec.redactedRawChunkSetId`, and `pruneOlderThan` matches it at
`content-store/src/store.ts:277` as `name.slice(0, -5)` — **filename only, no
directory**. Fixing `locateChunkSet` alone leaves C2 live. This is the proof
that the bug is the key, not the helper.

### Existing tests are green through all of it

```
npx vitest run test/record-output-evidence-gc.test.ts test/retention-prune.test.ts \
  test/locate-chunk-set.test.ts --typecheck.enabled=false
 Test Files  3 passed (3)   Tests  12 passed (12)
```

## §3 Blast radius — every consumer of the bare-id key

| path | route | failure |
|---|---|---|
| DELETE | `evidence-gc.ts:21-30` → `locateChunkSet` → `deleteOverlayChunkSet`, fed by `evidence-ledger/src/store.ts:303` | deletes a foreign, often live, chunk set |
| PRUNE/PIN | `retention-prune.ts:15-34` → `pruneOlderThan` `keepChunkSetIds` (`store.ts:277`) | one repo's pin over-retains another repo's expired chunk |
| READ | `fetch-chunk.ts:12` → `locateChunkSet` | a session reads a foreign file; masks the deletion |

Delete entry point: `apps/cli/src/hooks/gc.ts:105` inside `maybeRunOverlayGc`,
called from `apps/cli/src/hooks/saver-run.ts:185` on every compressed tool
output, daily-throttled. It is the only caller and it is unattended.
Prune entry points: `apps/cli/src/hooks/gc.ts:82` and
`apps/cli/src/commands/output/gc.ts:27` (`mega output gc`).
Read callers: `core/src/context-gate.ts:10` → `mcp-bridge/src/tools/fetch-chunk.ts:57`
(`proxy_expand_chunk`), `daemon/src/handlers-registry.ts:44`,
`apps/cli/src/commands/output/chunk.ts:61`.

The READ path is **not** a disclosure: the id is `sha256` of the pre-redaction
raw and redaction is deterministic, so a colliding set holds byte-identical
content. It stays a correctness hazard, and it is what made the deletion silent.

## §4 Chosen approach — scope the key, once, where all three routes pass

**Every id that identifies a file to delete or protect carries its
`(workspaceKey, sessionRef)` scope. No code resolves a chunk file to delete by
id alone.**

1. **`ChunkDeletePort` carries the scope** (`evidence-ledger/src/ports.ts`):

   ```ts
   export type ChunkRef = {
     workspaceKey: WorkspaceKey;
     sessionRef: SessionRef;
     chunkSetId: string;
   };
   export type ChunkDeletePort = (ref: ChunkRef) => Promise<void>;
   ```

   `gcEvidence` (store.ts:303) and `revokeEvidence` (store.ts:239) pass the
   record's own `workspaceKey` / `sessionRef` alongside the id. The ledger still
   never imports `content-store`; the port stays the seam.

2. **`evidence-gc.ts` deletes only at the scoped path.** `locateChunkSet` leaves
   the delete path entirely: a `{kind:"live"}` ref maps to
   `deleteOverlayChunkSet({storeRoot, workspaceKey, liveSessionId: ref.sessionRef.id, chunkSetId})`;
   anything else is a no-op — identical to today's `at?.layout !== "overlay"`
   early return, so no behaviour outside the collision changes.

3. **The prune hold-set is keyed by the same triple.** `content-store` exports
   one `chunkSetKey({ topDir, sessionDir, chunkSetId })` helper (a `/`-joined
   string); `pruneOlderThan` takes `keepChunkSetKeys` and builds the key from its
   own walk; `heldChunkSetIds` builds it from `rec.workspaceKey` +
   `rec.sessionRef.id`. One exported function is the shared key — that is the
   whole point of the fix, so it is not a speculative abstraction.

4. **Fail directions are deliberately opposite.** A delete whose scope cannot be
   resolved does nothing (fail closed — never delete on a guess). A *hold* whose
   scope cannot be resolved (a `sessionRef` that is `null` or `durable`, only
   reachable via a hand-edited ledger) is emitted as a **bare** id, and
   `pruneOlderThan` keeps a file when either the scoped key or the bare id is in
   the set (fail open — over-retain rather than delete a pinned chunk). Scoped
   keys contain `/`; chunk ids never do, so the two forms cannot be confused.

5. **`locateChunkSet` keeps serving the READ path**, with its false comment
   replaced by the real invariant: ids may collide across sessions; colliding
   sets are byte-identical by construction, so any match serves a read; it must
   never resolve a delete. A guard test pins that (§6).

Diff shape: one type in `ports.ts`, two call sites in `evidence-ledger/store.ts`,
the `deleteChunk` closure in `evidence-gc.ts`, the key build in
`retention-prune.ts`, one param + one `has()` in `content-store/store.ts`, one
comment in `locate-chunk-set.ts`.

## §5 Alternatives rejected

- **Fix `locateChunkSet` only** (return all matches / prefer exact) — proven
  insufficient by scenario C2, which never calls it. Leaves the pin walker
  broken. This is the trap the finding's title invites.
- **Bind `deleteChunk` per workspace inside `sweepEvidenceStore`'s existing
  `workspaceKeys` loop** — free workspace scope with no port change, so it fixes
  C1. But two sessions **in the same workspace** are the common case (same repo,
  `pnpm test` twice), and this leaves them colliding. Insufficient, and it hides
  that fact behind a passing cross-workspace test.
- **Re-salt the ids: `cs-${sha256(workspaceKey + sessionId + raw)}`** — restores
  §3d uniqueness and would let every consumer keep its bare-id key. Rejected:
  (a) content-derived, session-independent ids are load-bearing for the
  first-sight saver dedupe (`saver-seen.ts`) and for `diff-on-reread`; (b) it
  does nothing for the colliding files already on disk in every user's store, so
  the delete path stays unsafe for the whole retention window; (c) it treats a
  legitimate design choice as the bug when the bug is an unenforced assumption.
- **Verify a content digest before `rm`** — the colliding sets are
  byte-identical, so the digest matches and the live copy is deleted anyway.
  Cost with no benefit.
- **Stop deleting on ambiguity (skip when >1 match)** — makes GC delete nothing
  on precisely the colliding sets it must collect; the store grows without
  bound. Explicitly not a fix.
- **Make the port return `boolean` so `gcEvidence` degrades only after a real
  delete** — closes the "record says deleted, file still there" stranding for
  unscopable refs. Rejected as scope creep: with the scoped ref, every record the
  saver writes is scopable (`record-output.ts:307` always writes
  `{kind:"live"}`), and the residual case predates this defect. Recorded here so
  it is not re-derived from scratch later.

## §6 Regression risk, and the test that catches each

| what could break | test |
|---|---|
| Fix over-corrects: the expired record's OWN chunk is no longer collected — "GC deletes nothing" | `evidence-gc`: expired record in session A, sweep, assert A's file is **gone** and `degraded === 1` |
| Under-corrects: the live twin still dies | same store, second session B with the identical id; assert B's file **survives** and `fetchChunk` on B still returns `ok:true` |
| Cross-workspace variant returns via a different route | scenario C1 as a test: repo A sweep, repo B's file survives |
| Pin walker: pins stop protecting (data loss) | existing `retention-prune.test.ts` "keeps the raw chunk a pinned record points at" must stay green |
| Pin walker: pins over-protect across scopes (store never shrinks) | scenario C2 as a test: repo A pinned + repo B unpinned/expired, same id → B **pruned**, A kept |
| Prune stops collecting ordinary expired sets | existing `content-store/test/prune-overlay.test.ts` + `store.test.ts` `pruneOlderThan` suites |
| A future refactor reintroduces the store-wide scan in a delete path | guard test: `evidence-gc.ts` and `retention-prune.ts` source contains no `locateChunkSet` import (same shape as `dependency-direction.test.ts`) |
| Ledger↔store decoupling broken by the new type | existing `evidence-ledger/test/dependency-graph.test.ts` (no `content-store` import) |
| Read path regressions | existing `fetch-chunk*.test.ts`, `locate-chunk-set.test.ts` |

Public API changes (`ChunkDeletePort`, `pruneOlderThan`'s param): pre-1.0, no
compat shim per §13; a changeset covers `@megasaver/evidence-ledger`,
`@megasaver/content-store`, `@megasaver/context-gate`.

## §7 LOCKED tables

None. No LOCKED table is read or amended by this fix. The only invariant text
touched is the non-normative comment at `locate-chunk-set.ts:14`, which is
corrected because it is factually false, not relaxed.

## §8 CRITICAL-level confirmations (CLAUDE.md §12)

- Risk **CRITICAL**: the defect deletes user data. Not downgradable.
- The repo owner requested this work (defect dispatched for spec + plan);
  implementation is a separate, reviewed step.
- Required before merge: `code-reviewer` **and** `critic` (separate passes),
  `security-reviewer`, and verifier evidence that reproduces both directions
  (§6 rows 1 and 2) against the built packages.
- Forbidden: unsupervised loops (`autopilot`, `ralph`) on this branch.
- Implementation happens in a worktree on `fix/evgc-content-id-collision`.
  No `main` edits.
