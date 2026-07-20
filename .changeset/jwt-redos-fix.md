---
"@megasaver/policy": patch
---

Fix a quadratic ReDoS in the `jwt` redaction detector: a leading
`(?<![A-Za-z0-9_-])` lookbehind rejects start positions glued to a base64url
character, taking 313 KiB of adversarial input from 8,374 ms to 0.45 ms.

**Behavior change:** a JWT preceded directly by a base64url character —
including `-` and `_`, so `session-<jwt>` and `id_token_<jwt>` — no longer
redacts and stays in cleartext. This is intended and accepted per
`docs/superpowers/specs/2026-07-20-jwt-redos-fix-design.md` §5: the `-` and `_`
characters must stay in the lookbehind class, because narrowing it to
`(?<![A-Za-z0-9])` recovers those two shapes and reintroduces the full
quadratic (7,494 ms at the same scale). Every standard JWT carrier — `=`, `:`,
`"`, `;`, whitespace, start-of-string — is preserved, and 14 frozen cases
assert byte-identical output against the pre-fix pattern.

Patch rather than minor: no API surface changes. `redact`,
`redactWithFindings`, `redactForLedger`, `RedactResult`, and the `jwt` finding
name are all unchanged.
