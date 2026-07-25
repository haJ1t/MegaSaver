## [2026-07-25 19:05 +03] fix | any-workspace READ clobbered registry-session stats

Post-merge review finding C1 on `259fed05`. That fix added the layout
discriminator to `reconcileOverlaySummaries` only. `readOverlaySummaryAnyWorkspace`
(packages/stats/src/store.ts) still walked every `stats/<dir>` as an overlay
workspace behind `isSafeSegment` — and overlay summary reads SELF-HEAL, so a
schema miss writes. Reproduced: one registry `appendEvent`, one scan call →
`stats/<projectId>/<sessionId>.json` rewritten to all zeros with `rebuiltAt`,
`readSummary` threw `store_corrupt`. Reachable from `mega audit session`,
`mega audit honest` (never consults the registry) and
`mega hooks status --session`.

Fix: all three `stats/*` walkers in `store.ts` share one `overlayWorkspaceKeys`
helper applying `workspaceKeySchema`. After: scan `null`, summary byte-identical,
`readSummary` intact. 1 red → green guard test in
`packages/stats/test/read-overlay-any-workspace.test.ts`; `pnpm verify` 56/56.
Fake fixture keys (`workspace-aaa`, `wk-alpha`) in three CLI overlay tests
replaced with real 16-hex keys. Branch `fix/review-C1-stats-sibling-clobber`.

Lesson recorded in [[entities/stats]]: guarding ONE walker does not close the
defect class; grep every sibling `readdirSync(join(root, "stats"))` first.

NOTE: this file arrived at 0 bytes on `main` (emptied by a merge conflict
resolution in the five-branch merge, `5a13a8c2`/`d213947e`). The header and
prior entries are recoverable from `git show 259fed05:wiki/log.md`; not restored
here to avoid guessing at a parallel agent's rotation.
