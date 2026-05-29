---
"@megasaver/policy": minor
---

Add the `@megasaver/policy` security gate package: `evaluateCommand`
(allow-list + dangerous-pattern + `MEGASAVER_ORIGIN_PID` re-entry guard),
`evaluatePathRead` (secret-path denylist), `redact` (baseline secret
redaction), and the closed alphabetic `policyDenyCodeSchema` /
`PolicyDenyCode` enum.
