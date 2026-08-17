---
"@megasaver/core": minor
"@megasaver/cli": minor
---

Session resurrection: `mega resume <sessionId>|--last` builds a bounded,
redacted, evidence-pointer kickoff capsule from a dead session's stored
state (stdout / --copy / --next). `--next` delivers at-most-once through
the task-kickoff UserPromptSubmit seam. Consumes `listOverlayChunkSets`
(content-store, delivered by compaction-guard) and re-exports
`readOverlaySummary` (core).
