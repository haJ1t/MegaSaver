---
"@megasaver/output-filter": minor
---

feat(output-filter): diff-aware compressor for git diff/status/log

Add a `diff` output category and `compressDiff` compressor, dispatched
like the existing vitest/tsc compressors. For a unified diff it keeps
every file/hunk header and every +/- changed line, reduces surrounding
unchanged context to one line each side, and collapses fully-unchanged
runs to a `… [N unchanged]` marker. For `git status` / `git log --stat`
it keeps every content line — stat summaries, commit subjects (including
ones containing a literal `|`), and `| * <sha> <subject>` graph content
lines — and collapses only pure graph-spine runs to a `… [N graph]`
marker. Deterministic: every collapse emits a counted marker, so distinct
data items are never silently dropped; only redundant unchanged context
and graph decoration are trimmed from what is RETURNED.

The diff category is sniffed conservatively: command-less output is only
classified `diff` when it carries a real `diff --git` header or `@@ … @@`
hunk, so npm/console logs, markdown bullets, and ASCII pipe tables are
not routed to this compressor.
