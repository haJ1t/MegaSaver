---
title: Context Pruner — Git Co-Change Ranking Signal
status: approved
risk: medium
created: 2026-06-29
---

## Goal

Add a deterministic git-history **co-change** factor to the LAMR context
pruner so that blocks whose file historically co-evolves with the edit-site
file (`changedFiles`) rank up. This surfaces the migration / fixture / config
that always changes alongside the edit site but is invisible to call/import
edges (`dependencyRelevance`).

Hard constraints (inherited from the output-compression / pruner contract):

- **Deterministic, no LLM.** Factor is computed purely from `git log` output.
- **Evidence-preserving.** Ranking only reorders candidates; it never merges,
  drops, or hides a block's content.
- **No-op on no history.** A shallow/empty/non-git repo yields an empty
  co-change map; the factor is `0` for every block and ranking is unchanged.
  Never throw.

## Mechanism

1. **Parse once, cached.** Run `git log --numstat` (a single child process) and
   parse it into a co-change map at index/build time or on first use, then cache
   for the process lifetime. The unit under test takes the **raw numstat text**
   as input — it does not shell out — so tests inject a fixture string.
2. **Co-change map.** For each commit, collect the set of files touched
   (numstat rows). For every unordered pair in that set, increment a co-change
   counter. Also accumulate per-file churn (sum of added+deleted lines). Result:
   per file, the set of other files it changes together with, plus a frequency.
3. **Factor.** `coChangeRelevance(block)` = normalized co-change strength
   between `block.filePath` and the `changedFiles` set (0..1, top-normalized in
   the same spirit as `semanticRelevance`). A block whose file never co-changed
   with any edit-site file scores `0`. Churn is available as a tie/secondary
   signal but the primary lever is co-change frequency with the edit site.
4. **Wire into scoring.** Add `coChangeRelevance` to `ScoreFactors`, assign it in
   `scoreBlocks`, add it to `finalScore` as a weighted positive term, and add a
   `coChange` weight to `WEIGHTS`. Weight sits below `dependency` (it is a softer
   signal): proposed `coChange: 0.5`. Do not restructure the scorer.

Empty `changedFiles` OR empty co-change map ⇒ factor is `0` for all blocks ⇒
`finalScore` is identical to today (additive zero term).

## Files to touch

| File | Change |
|------|--------|
| `packages/context-pruner/src/cochange.ts` | **New.** `parseNumstat(raw: string)` → co-change map + churn; `coChangeStrength(map, filePath, changedFiles)` → 0..1. Pure, no I/O. |
| `packages/context-pruner/src/pack.ts` | Add `coChangeRelevance: number` to `ScoreFactors`. |
| `packages/context-pruner/src/score.ts` | Compute co-change map (cached) from injected/loaded numstat; assign `coChangeRelevance` in `scoreBlocks`; add weighted term to `finalScore`. |
| `packages/context-pruner/src/weights.ts` | Add `coChange: 0.5` to `WEIGHTS`. |
| `packages/context-pruner/test/cochange.test.ts` | **New.** Unit tests (see Test plan). |

The `git log --numstat` invocation + caching wrapper lives at the call site that
already has repo/index access (build/index time or first use in `score.ts`); the
unit-tested core (`cochange.ts`) is I/O-free and takes the raw string.

## Lossless / evidence-preservation note

This factor only changes the **order** of scored candidates fed to selection.
Raw output remains persisted to its ChunkSet and recoverable via
`mega_fetch_chunk`; selection only changes what is returned, never what is
recoverable. No block is merged with another, and no distinct error/diagnostic
is hidden — co-change reranks whole blocks, it does not edit their bytes.

## Test plan

Unit tests in `cochange.test.ts`, all driven by an injected raw
`git log --numstat` fixture string (no dependence on the real repo history):

1. **Map computed from fixture.** Given a numstat string where `a.ts` and
   `migrations/001.sql` appear together in N commits, `parseNumstat` returns a
   map linking them with the correct frequency, and per-file churn matches the
   summed added+deleted counts.
2. **Factor raises a co-changing file's score.** With `changedFiles = ["a.ts"]`,
   a block in `migrations/001.sql` gets `coChangeRelevance > 0` and a higher
   `finalScore` than the same block scored with no co-change history — and a
   block in an unrelated file (`z.ts`, never co-changed with `a.ts`) stays at
   `coChangeRelevance === 0`.
3. **Empty / absent history ⇒ no-op, no throw.** `parseNumstat("")` (and a
   non-git / shallow scenario surfaced as an empty string) yields an empty map;
   every block's `coChangeRelevance` is `0`; the full ranking is byte-identical
   to the pre-feature ranking; nothing throws.

## Out of scope

- No change to the BM25 / dependency-closure / test-failure logic.
- No restructuring of `scoreBlocks` / `select.ts` / `pack.ts` beyond the one
  new factor field.
- No persistence/caching layer beyond a simple process-lifetime memo of the
  parsed map.
- No time-decay or author weighting of co-change (frequency only for v1).
- No new CLI flag or MCP surface; the factor is internal to the pruner.
