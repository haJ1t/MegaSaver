---
"@megasaver/cli": patch
---

context-gate: strip the value-free `firewall` counts (and, on the overlay
paths, `trace`) from the agent-visible tool result. These are measurement
data consumed only by the firewall ledger / replay-trace writer (§P2.6) and
were needlessly spending agent tokens on every redaction-bearing read or
command. The ledger still records every event.
