---
"@megasaver/long-memory": patch
---

Drop dead exported surface: `listAnchoredDirectory` (no reference anywhere,
including its own module) and `MAX_LM1_EVIDENCE_LOOKUPS` / `MAX_LM1_TOKEN_BUDGET`
(defined and never read). `MAX_LM1_RECORDS_SCANNED` and `MAX_LM1_CANDIDATES` are
consumed inside `lm1-recall.ts` itself, so only their `export` keyword was dead —
they stay as module-internal constants.
