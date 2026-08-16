---
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Memory write-verify: deterministic write gate for agent-sourced memory
entries and FORGE rules (evidence pointers must resolve; contradictions
quarantine), write-time confidence caps, and 90-day default TTL enforced
losslessly by `mega memory sweep` (`expired=` / `rulesExpired=` reporting;
`rankApplicableRules` gains `asOf` read-exclusion).
