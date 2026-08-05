---
"@megasaver/cli": minor
"@megasaver/connector-claude-code": minor
"@megasaver/pro-analytics": minor
---

Add an opt-in `mega cache --suffix-audit` read-only analysis. The Pro gate
runs before any usage or settings I/O; free-tier invocations read neither.
The audit adds a closed `suffixAudit` object to `--json` output only (plain
`mega cache --json` stays byte-compatible) with a `measured-global`
composition over exactly the four measured token classes — a zero denominator
reports `no-usage` with null shares, never a misleading 0% — plus static
Claude settings risks from a closed code union (duplicate owned hooks,
foreign custom base URL, missing first-party flag on the owned route,
settings unreadable/malformed, generated-output byte variance).

Composition is measured fact, not an avoidable-cost claim: a cache-write
share is the share of measured tokens, not a savings prediction. No risk
carries a free-text detail, so URLs, commands, secrets, paths, and settings
content never appear in the report.
