---
"@megasaver/cli": patch
---

policy: fix `url_basic_auth` redaction leaving a password FRAGMENT when the
password contains `@`. `curl https://user:p@ss@host` previously redacted to
`https://[REDACTED]@ss@host`, leaking `@ss@host` — a gap that reached every
redaction sink (agent-visible output AND the value-free firewall ledger). The
password now spans `@`/`/`/`:` and anchors to the first `@` followed by a real
host + delimiter, scrubbing the full credential without over-matching a later
`@` in the path (e.g. `/@2x.png`).
