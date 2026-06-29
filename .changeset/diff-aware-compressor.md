---
"@megasaver/output-filter": minor
---

feat(output-filter): diff-aware compressor for git diff/status/log

Add a `diff` output category and `compressDiff` compressor, dispatched
like the existing vitest/tsc compressors. For a unified diff it keeps
every file/hunk header and every +/- changed line, reduces surrounding
unchanged context to one line each side, and collapses fully-unchanged
runs to a `… [N unchanged]` marker. For `git status` / `git log --stat`
it keeps the file/stat summary and drops decorative graph spine lines.
Deterministic and lossless — full output still persists to the ChunkSet
and is recoverable via `mega_fetch_chunk`; only what is RETURNED shrinks.
