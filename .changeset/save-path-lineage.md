---
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

save_memory detects supersession/dedupe via saveMemoryWithLineage (response
gains `supersession?`/`deduped?`; best-effort cosine inputs from the memory
sidecar). from-session writers switch to detect:false lineage saves; `mega
task status --save-summary` gains detection with stderr disclosure.
