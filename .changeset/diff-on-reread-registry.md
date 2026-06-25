---
"@megasaver/context-gate": minor
---

Diff-on-reread (registry pipeline): an unchanged re-read of a file within the
same session is suppressed. runOutputPipeline now hashes the raw bytes before
filtering; on a read-index hit with a matching hash it returns a lossless
unchanged marker (zero excerpts, the prior chunkSetId preserved so the agent can
still expand to full content) and skips both filter and persist. The read-index
is recorded only after a successful chunk-set persist so priorChunkSetId always
resolves.
