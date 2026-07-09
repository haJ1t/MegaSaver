---
title: Saver Recovery Wave 2 (C12 multi-chunk + C14 overlay GC) — design
status: approved-pending-user-review
risk: HIGH
created: 2026-07-09
base: feat/saver-coverage (wave 1 — stacked; merges after PR #276)
sources:
  - wiki/syntheses/saver-savings-gaps.md (findings C12, C14)
  - grounding workflow wf_7988710f-7f9 (4 scouts, 2026-07-09)
---

# Saver Recovery Wave 2 — design

## TL;DR

Wave 1 made hook-compressed output recoverable; wave 2 makes recovery
CHEAP and the store SELF-CLEANING. (C12) The full redacted raw is stored
as one giant chunk `"0"`, so any expansion re-injects compressed + full
raw — always worse than no compression. Split it into uniform 40-line
chunks so the agent fetches only the slice it needs. (C14) Overlay chunk
sets are never deleted: `pruneOlderThan` exists but its strict registry
schema rejects overlay files (`catch { continue }`) AND nothing ever
calls it. Fix the schema, add a throttled best-effort trigger + a manual
CLI command.

## Locked decisions (user, 2026-07-09)

1. **C12 = uniform 40-line chunks** (`chunkByLines(text, 40)` — the
   existing output-filter splitter; registry precedent `id: String(i)`).
   Footer stays fixed-size via a line→id formula, no per-chunk listing.
2. **C14 = 30-day age retention, hardcoded consts** (heartbeat-TTL +
   `MAX_TRACE_SESSIONS` "no env override — YAGNI" precedents), triggered
   best-effort from the saver hook at most once/day (marker file) plus a
   manual `mega output gc` command.

## §1 Multi-chunk write (`packages/context-gate/src/record-output.ts`)

- Replace the single-chunk construction (L126-151): the full
  `redactedText` is split via `chunkByLines(redactedText, 40)` and
  persisted as `chunks: split.map((c, i) => ({ id: String(i),
  startLine: c.startLine, endLine: c.endLine,
  bytes: byteLength(c.text), text: c.text }))`.
- Empty-text edge: current behavior preserved — `redactedText === ""`
  still writes the single empty chunk `"0"` (lines 1-1).
- `RecordOverlayOutputResult` gains `chunkCount?: number` (the footer
  needs N). `chunksStored` (stats event) becomes the real count.
- Evidence row: `returnedChunkRefs` becomes the real per-chunk ref list
  (`chunks.map((c) => ({ chunkSetId, chunkId: c.id }))`) — the
  evidence-ledger sub-schema already models an array of refs. If the
  ledger caps the array, the plan pins the cap behavior.
- Old single-`"0"` sets keep working unchanged: `fetchOverlayChunk`
  looks chunks up by id and the schema always allowed multiple chunks —
  no migration.

## §2 Footer (`apps/cli/src/hooks/saver.ts`)

- `chunkCount === 1`: today's wording unchanged
  (`run: mega output chunk "<set>" "0"`).
- `chunkCount > 1`:
  `Full output recoverable in <N> chunks of 40 lines (chunk i covers
  lines 40*i+1..40*i+40) — run: mega output chunk "<set>" "<i>" (or MCP
  proxy_expand_chunk if connected)`.
  The agent computes the id from the line number it needs; the footer
  stays O(1) regardless of N.
- PARTIAL-truncation variant keeps its warning, same N-aware body.

## §3 Pruner schema fix (`packages/content-store/src/store.ts`)

- `pruneOlderThan` parse order per file: `chunkSetSchema` → on failure
  `overlayChunkSetSchema` → on failure skip (unknown file untouched).
  Both schemas carry `createdAt`; the age comparison is shared. Registry
  and overlay sets get the same retention (consistent).
- After a session dir empties, remove it (and then an emptied top dir) —
  best-effort `rmdir`, never against `read-index.json`/
  `shown-index.json` (existing skips preserved; a dir containing them
  is not empty and stays).

## §4 GC trigger + CLI

- Constants (context-gate, exported for tests):
  `OVERLAY_RETENTION_MS = 30 * 86_400_000`,
  `GC_INTERVAL_MS = 86_400_000`.
- **Hook trigger:** after a successful compression the saver hook
  fire-and-forgets a throttled GC: read mtime of marker
  `<storeRoot>/content/.last-gc`; if absent or older than
  `GC_INTERVAL_MS`, touch it first (so concurrent hooks don't stampede)
  then `pruneOlderThan({ storeRoot, olderThan: now - RETENTION })`
  wrapped in try/catch-swallow — housekeeping, not correctness
  (`pruneTraceSessions` precedent). Never blocks or fails the tool call.
- **CLI:** `mega output gc [--days <n>] [--store] [--json]` — calls
  `pruneOlderThan` with `--days` override (default 30), prints
  `removed N chunk set(s)` or `{removed}` JSON. NOT Pro-gated
  (housekeeping, like the other `mega output` commands). `--days`
  validated positive integer ≤ 3650 (parseDays precedent).
- The marker file lives inside `content/` but has no `.json` suffix —
  the pruner walk only considers `*.json`, so it is never treated as a
  chunk set; the dir-emptying rmdir skips dirs containing it (top-level
  marker sits in `content/` itself, which is never removed).

## §5 Error handling / edge cases

- GC failures are swallowed at the hook trigger, loud in the CLI
  (exit 1 + message on a real store error).
- A chunk set with a future `createdAt` is never pruned (age comparison
  handles it naturally).
- Registry sets keep being pruned exactly as before (behavior widened to
  overlay, not changed for registry).
- Deleting mega's own cache store is NOT user-data deletion (§12
  CRITICAL class): chunk sets are recoverable copies of tool output the
  model already saw, in mega's own store dir; originals live in the
  user's repo/tools. HIGH process applies, not CRITICAL.

## §6 Testing (TDD, red first)

- record-output: >40-line raw → N chunks with contiguous line ranges,
  ids `"0"..String(N-1)`, byte counts real; ≤40-line raw → single chunk
  `"0"` (regression); empty raw unchanged; `chunkCount` in result;
  evidence refs = all chunks; stats `chunksStored === N`.
- saver footer: N=1 wording unchanged (regression); N>1 contains
  `in <N> chunks` + the formula + `"<i>"`; roundtrip: fetch chunk `"2"`
  of a 5-chunk set returns lines 81-120 exactly.
- pruner: old overlay set deleted, young overlay survives; old registry
  still deleted (regression); mixed dir; unknown/corrupt file untouched;
  empty session dir removed, dir with read-index survives; marker file
  never deleted.
- hook trigger: first compression fires GC (marker created), second
  within interval does NOT (throttle), GC throw does not affect the
  compression result; marker touched before prune (stampede guard).
- CLI gc: default 30 days, `--days 1` override, `--json` shape, bad
  `--days` → exit 1, empty store → `removed 0`.
- Integration: compress 200-line output → footer advertises 5 chunks →
  `mega output chunk <set> 3` returns lines 121-160 → `mega output gc
  --days 0` removes it → fetch now `chunk_set_not_found`.

## Non-goals (later waves)

`around`/line-window fetch (dead schema field stays); size/count-based
retention; daemon periodic GC; per-chunk ranking of WHICH chunks to
advertise (B/D waves); footer i18n.

## Risk & process

HIGH (§12): deletion mechanics in mega's own store + recovery-path
change. Worktree `feat/saver-recovery` STACKED on `feat/saver-coverage`
(PR #276 merges first). TDD; code-reviewer AND critic in separate fresh
contexts. Changeset: `@megasaver/context-gate` minor (new result field),
`@megasaver/content-store` patch, `@megasaver/cli` minor (new command).
