---
"@megasaver/context-pruner": minor
---

Add a deterministic git-history co-change factor to the LAMR context pruner.
`parseNumstat` turns raw `git log --numstat` text into a per-file co-change map
plus churn; `coChangeStrength` scores how strongly a block's file co-evolves
with the edit-site (`changedFiles`) set, normalized 0..1. Wired into
`scoreBlocks` / `finalScore` as a new `coChangeRelevance` factor with weight
`coChange: 0.5`, surfacing the migration / fixture / config that always changes
with the edit site but is invisible to call/import edges. No LLM, no I/O in the
scored core; absent/empty history is a no-op (factor is 0, ranking unchanged).

The factor is now live end-to-end. New `readCoChangeLog(cwd)` export shells out
`git log --numstat` once per repo (memoized, `""` on any failure) and is wired
into the MCP `packFor` and CLI `loadPack` paths, so a co-changing migration /
fixture / config actually reranks in production, not just in `scoreBlocks`.
