---
---

Restore `wiki/log.md`, which merge `5a13a8c2` resolved to an empty file, and add
a `pnpm verify` guard so the wiki cannot be silently emptied again.

`wiki/` is the project's only cross-session, cross-agent memory channel
(CLAUDE.md §0) and pages are never deleted, only archived (wiki/CLAUDE.md hard
rule 6). The merge dropped 4258 lines — every timestamped work entry the project
had — and `main` carried the empty file for two more commits with `pnpm verify`
green, because nothing in the suite looked at the wiki.

Recovered by re-running the merge with `git merge-file --union` over base
`89eea64f`: 4283 lines, no conflict markers, and zero lines lost from either
parent. `apps/cli/test/wiki-integrity.test.ts` now fails on any empty tracked
wiki page and on a `log.md` that falls below 50 timestamped entries.

No package API changed — docs and test only.
