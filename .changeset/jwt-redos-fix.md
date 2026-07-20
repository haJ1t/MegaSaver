---
"@megasaver/policy": minor
---

Fix a quadratic ReDoS in the `jwt` redaction detector and recover the
percent-escaped carriers the first attempt lost.

**The quadratic is removed.** A two-branch leading lookbehind
`(?:(?<![A-Za-z0-9_-])|(?<=%[0-9A-Fa-f][0-9A-Fa-f]))` rejects start positions glued to a base64url
character, taking 313 KiB of `'eyJaA0'.repeat(n)` from 8,374 ms to 0.45 ms.
This is ordinarily reachable, not merely adversarial: `Buffer.toString("base64url")`
of any JSON payload produces a long dotless run, and 320 KiB of it measured
575.9 ms before the fix.

**Percent-escaped carriers are recovered.** Branch 2, `(?<=%[0-9A-Fa-f][0-9A-Fa-f])`, restores
redaction for a JWT preceded by a percent-escape — URL query strings and
fragments, among the most common places a JWT appears in agent output. All 512
`%XY` forms were verified. That covers a single well-formed escape only, not
percent-encoded input in general: double-encoded `%25XX` (`%253D`, `%2520`)
and an escape truncated at a buffer boundary (`%X`) still fall in the loss
class below, because the byte immediately before the JWT is then a raw
base64url character. The branch costs 0.32 ms per 313 KiB and stays
linear, because `%` sits outside the run class and terminates the dotless run.

**Coverage reduction — read this.** A JWT preceded directly by a *raw*
base64url character, including `-` and `_`, no longer redacts and stays in
cleartext: `session-<jwt>`, `id_token_<jwt>`, `Bearer<jwt>` with no space,
`ghs_<body>_<jwt>`, and base64-run glue. **No other detector provides fallback
coverage for any of these** — verified through the full sequential-replacement
pipeline, where every one leaves the complete signature in cleartext. The
`ghs_` shape is the sharpest: `github_token` does fire, so findings are
non-empty and the leak is easy to miss, but it redacts only the prefix.
Escaped-equals forms `\x3d` and `\u003d` are lost the same way; `&#61;` is not
affected. Accepted per
`docs/superpowers/specs/2026-07-20-jwt-redos-fix-design.md` §5: the `-` and `_`
must stay in branch 1's class, because narrowing it to `(?<![A-Za-z0-9])` recovers
`session-` and `id_token_` and reintroduces the full quadratic (7,728 ms and
7,416 ms at 313 KiB).

Minor rather than patch: the public API is unchanged — `redact`,
`redactWithFindings`, `redactForLedger`, `RedactResult`, and the `jwt` finding
name are all identical — but a reduction in redaction coverage must be visible
at release rather than auto-merged as a patch.
