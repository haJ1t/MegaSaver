---
"@megasaver/cli": minor
---

`mega alerts` — deterministic anomaly alerts over the savings + firewall
streams (median+MAD spike detection: daily traffic, per-source, saving-ratio
collapse, firewall-event surge, plus budget pace) — and `mega savings budget
set|show|clear`, a persistent stats/budget.json savings goal.
`mega savings forecast` now auto-loads the stored budget (explicit flags win;
the pace line says "stored budget"; `--json` adds `goalSource`).
