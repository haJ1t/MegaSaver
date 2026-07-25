---
"@megasaver/core": patch
"@megasaver/mcp-bridge": patch
---

Fix `captureCodeAnchor` spawning one `git rev-parse HEAD:<path>` per related
file. `relatedFiles` arrives from the `save_memory` MCP tool with no `.max()`
on either schema (`save-memory.ts:56`, `memory-entry.ts:93`) and no request-size
cap on the bridge, and capture runs *before* `registry.createMemoryEntry`, so
nothing downstream bounded the list. The loop contains no `await`, so the whole
capture was one uninterruptible synchronous span — a large list froze the entire
stdio server, not just the caller's request. The 3000 ms `execFileSync` timeout
bounds one spawn, never the count.

Fixed by asking git once, exactly as `code-truth.ts` already does for the verify
side: `cat-file --batch-check` with the `HEAD:<path>` queries on stdin, replies
paired positionally (safe because anchor paths are control-char-free by schema).
Measured through `captureCodeAnchor` against a real 2,000-file repo, same
anchors out:

| cited files | before | after |
|---|---|---|
| 100 | 631 ms | 62 ms |
| 500 | 3,305 ms | 139 ms |
| 2,000 | 13,237 ms | 296 ms |

Untracked paths are still skipped rather than anchored (`<query> missing`), and
a git failure mid-capture still degrades to "no file anchors" with symbol
capture continuing — capture stays best-effort and total.

The injected `execGit` runner (`captureCodeAnchor` opts, `SaveMemoryEnv.execGit`)
now takes a third `input` argument and **must forward it to git's stdin**; a
runner that ignores it reads every cited file as untracked.

Guarded at both call sites by spawn *counts* at two input sizes — 20 and 400
cited files, same count, no truncation — in
`packages/core/test/memory-anchor-capture.test.ts` and
`packages/mcp-bridge/test/tools/save-memory-anchor.test.ts`, plus a real-git test
that batched replies stay paired to the right paths across an untracked gap.
