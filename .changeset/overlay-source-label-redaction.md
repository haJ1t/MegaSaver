---
"@megasaver/context-gate": patch
---

Redact the source label before it is persisted on the saver hot path. The
overlay chunk-set `source` (command/url/grep-query/file-path) and the overlay
stats event `label` previously stored the raw label — a credential-bearing
command line (`curl -H "Authorization: Bearer ..."`), a token-bearing fetch
URL, or a secret-laden path landed on local disk even though the chunk CONTENT
was already redacted. `recordAndFilterOverlayOutput` now runs the
`@megasaver/policy` `redact` over the label once and feeds the redacted form to
both write points, mirroring the `policyRedactSourceRef` port on the evidence
path. Redaction keeps the label readable (secret → marker, not blanked); a
redacted fetch URL still passes the `overlayChunkSetSchema` `z.string().url()`
guard, so `mega audit`/recall display the same source minus the secret.

Scope: this closes the leak for the `recordAndFilterOverlayOutput` overlay path
and for the secret shapes `redact` recognises (prefix/structure-based: `ghp_`,
`sk-`, `AKIA`, `Bearer <tok>`, JWT, private-key blocks, quoted env values, DB
URLs). Generic secrets with no recognised shape (e.g. a bare `?token=<hex>`
query param or `user:pass@host` basic-auth) are still not caught — the same
blind spot the content redactor has. The parallel `run-command.ts`
(`proxy_run_command`) and `run.ts`/`read.ts` file-read saver paths persist their
own raw command/args/path and are NOT covered here; both are tracked as
follow-ups.
