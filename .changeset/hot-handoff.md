---
"@megasaver/core": minor
"@megasaver/cli": minor
"@megasaver/connectors-shared": minor
"@megasaver/entitlement": minor
"@megasaver/stats": minor
---

Hot Handoff (i10): `mega handoff pack/open/inspect/clear` — redacted,
expiring `.megahandoff` task packets carry live task state across agents.
`pack` (Pro; `--dry-run` free) writes a budgeted brief, recallable
memories, unresolved failures, and a secret-path-filtered dirty diff into a
hash-framed packet; `open` (Pro) applies it as a redaction-guarded HANDOFF
sentinel block in the target agent's config file (creating the file with
its header when absent) and optionally merges memories as suggested
entries; `inspect` (free) recomputes the redaction/secret-path scan from
the payload instead of trusting manifest claims; `clear` (free) removes the
block. New `"hot-handoff"` ProFeature key; advisory `HandoffEvent` stats
stream.
