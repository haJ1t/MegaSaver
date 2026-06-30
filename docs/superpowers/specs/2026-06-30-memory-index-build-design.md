---
topic: memory-index-build
risk: MEDIUM
status: approved
date: 2026-06-30
---

# Memory Index Build (WS3 increment 2)

## Problem

WS3 inc-1 shipped semantic memory recall (`searchMemoryEntriesSemantic`)
plus a per-project vector sidecar
`<storeRoot>/memory/<projectId>.embeddings.jsonl` built by
`embedMemoryEntries` (packages/core/src/embed-memory.ts). But
`embedMemoryEntries` has **zero production callers** — nothing populates
the sidecar. So `get_relevant_memories` always trips its full-coverage
guard (any candidate missing a vector ⇒ fall back) and degrades to BM25.
Semantic recall is dead code in practice.

## Goal

Add an explicit, on-demand build that populates the memory-vector
sidecar — mirroring code indexing's `mega index build`. **Not** an
auto-embed on every memory write: that would load the ~50MB model on the
memory hot path. The build is a deliberate user/agent action.

## Approach

A single shared core orchestrator drives both consumers (CLI + MCP);
they are thin callers. This avoids duplicating the prior-hash derivation
and summary-count logic in two places.

### Incrementality + the prior-hash gap

`embedMemoryEntries` carries a vector forward when the id already has a
vector AND `priorHashById.get(id) === memoryContentHash(currentEntry)`.
For code blocks, `priorHashById` comes from the manifest captured before
overwrite. Memory has **no manifest** — the vector sidecar stores
`{id, vector}` only, no hash. So an unchanged memory and a changed one
both have a vector present; without a stored hash we cannot tell them
apart, and incrementality is impossible.

**Decision:** add a tiny hash sidecar
`<storeRoot>/memory/<projectId>.embeddings.hashes.json` — a plain
`Record<id, contentHash>` written after each build, read back as
`priorHashById` on the next build. This is the manifest's role for
memory, in the smallest possible form. (Re-embedding everything every
build was rejected — it defeats the required incrementality.)

### New core function

`buildMemoryIndex(storeRoot, projectId, entries, embedFn = embed)` in
`packages/core/src/embed-memory.ts`:

1. Read prior hashes from the hash sidecar (missing ⇒ empty map ⇒ first
   build embeds everything).
2. Call `embedMemoryEntries(storeRoot, projectId, entries, priorHashes,
   embedFn)` — the existing incremental embedder.
3. Write current hashes (`id → memoryContentHash(entry)`) to the hash
   sidecar.
4. Return `{ embedded, carried, total }` where `embedded` = count whose
   prior hash is absent/changed, `carried` = unchanged, `total` =
   entries.length.

`embedFn` is threaded so tests inject a counting fake (no model). Default
is the real lazy `embed`.

### CLI: `mega memory index <project>`

Under the existing `memory` command group
(`apps/cli/src/commands/memory/index-build.ts`). Resolves project →
storeRoot + projectId via the same `resolveStorePath` /
`ensureStoreReady` / `listProjects` chain the other memory commands use.
Lists `registry.listMemoryEntries(projectId)`, calls `buildMemoryIndex`,
prints `embedded=N carried=M total=T` (or JSON with `--json`). Accepts an
injectable `embedFn` (default real) so the command-logic test runs
model-free.

### MCP: `mega_index_memory`

New tool in `packages/mcp-bridge/src/tools/index-memory.ts` + dispatch
registration in `server.ts` + name in `tool-name.ts`. Input
`{ projectId }`. Best-effort: resolves entries from the registry, calls
`buildMemoryIndex`, returns `{ embedded, carried, total }`. Embedding
errors are surfaced (never corrupt the store — `embedMemoryEntries`
already writes atomically via `writeVectors`).

## End-to-end proof (model-free)

After a build with the fake embed, `handleGetRelevantMemories` with a
fake query-embed now finds FULL coverage (every approved non-stale
candidate has a vector) → returns the semantic ranking instead of the
BM25 coverage-guard fallback. This is the test that proves the gap is
closed.

## CI model-free

The real `embed()` path is E2E-gated
(`it.skipIf(!process.env.MEGA_EMBED_E2E)`). All default tests inject a
counting-fake `embedFn`. `pnpm verify` loads no model.

## Testing (TDD, fail-first)

- core: `buildMemoryIndex` writes sidecar + hash sidecar; counts correct;
  rebuild after one memory changes re-embeds only that one (fake call
  count), carries the rest; dropped memory removed.
- cli: `runMemoryIndexBuild` resolves project, prints summary, exit 0;
  unknown project → exit 1.
- mcp: `handleIndexMemory` builds sidecar, returns counts; then
  `handleGetRelevantMemories` gets full coverage → semantic ranking
  (not BM25 fallback). End-to-end gap-closed proof.

## Out of scope

- Auto-embed on save (explicitly rejected).
- `mega doctor` coverage surfacing (optional; only if trivially clean).
