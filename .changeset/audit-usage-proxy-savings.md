---
"@megasaver/cli": minor
---

feat(cli): `mega audit usage` — estimated savings vs your real Claude usage

Fuses saver-hook tool-output compression savings (numerator) with the metering
proxy's real per-call token counts from `usage.jsonl` (denominator) to estimate
what fraction of your actual Claude token usage Mega Saver saved — the
`% of total` view `audit honest` couldn't give (it only covers the mediated
tool-output slice). Reports `saved of new context` and `saved of total processed`
plus the raw token counts.

Honest by construction: the numerator is windowed to the proxy's metering period,
and the ratio **fail-closes** — when `saved > new context` (the fingerprint of
partial proxy routing or a skewed window) both percentages are suppressed in
favor of the raw counts and a "route all traffic through `mega proxy`" hint, so a
partial-coverage 97% never masquerades as your real bill savings. Needs
`mega proxy` running with your agent pointed at it.
