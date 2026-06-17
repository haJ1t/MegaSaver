---
"@megasaver/policy": minor
---

Extend the secret detector to catch contextual (no-prefix) secrets. `redact()`
previously matched only prefix/structure-shaped secrets (`ghp_`, `sk-`, `AKIA`,
`Bearer <tok>`, JWT, private-key blocks, quoted `ENV=`, db-scheme URLs), so a
credential identifiable only by its context — a secret-named URL query param, a
credential in URL userinfo on a non-db scheme, a secret CLI flag value, or an
api-key/Basic auth header — passed through verbatim and reached disk via every
saver sink (`record-output` / `run-command` / `run` / `read`) and the evidence
`sourceRef`. Five new patterns close this, appended after the existing baseline
(which still runs first):

- `url_basic_auth` — `scheme://user:pass@host` on any scheme → `scheme://[REDACTED]@host`.
  Username may be empty (`redis://:pw@…`) and the password may contain `/`,
  matching the baseline `db_url` strength.
- `url_query_secret` — secret-named query **and fragment** params
  (`?token=`/`#access_token=`/`?api_key=`/`?password=`/…; gated to clearly
  sensitive names so benign `?page=`/`?sort=` are untouched). The fragment form
  covers OAuth implicit-flow callbacks.
- `cli_secret_flag_eq` — `--token=`/`--password=`/`--api-key=`/… values.
- `cli_secret_flag_spaced` — space-separated `--token "VALUE"` **only when the
  value is quoted**. An unquoted next token is indistinguishable from prose, a
  following flag, or a shell operator (`&&`, `|`, `>`), so it is deliberately
  not matched — over-redacting captured help/error text would corrupt the
  first-failure evidence the saver preserves.
- `api_key_header` — `x-api-key`/`x-auth-token`/`x-access-token` header values.
- `basic_auth_header` — `Authorization: Basic <b64>`.

Each uses a lookbehind on the indicator so only the secret value is replaced and
the readable structure (scheme/host/param/flag) survives; a redacted fetch URL
still passes the `overlayChunkSetSchema` `z.string().url()` guard.

Out of scope by design: a generic high-entropy matcher for a contextless opaque
token (a bare base64/hex blob in a path or arg with no secret-indicating key) is
NOT added — no regex can distinguish it from a git SHA, UUID, or hash without
mass false positives that would wreck `mega audit`/recall readability. Such a
token is caught only when it appears with a secret-indicating key/flag/header.

Known minor limits (tracked, not leaks of full credentials): a literal `@`
inside a URL password (which RFC 3986 requires percent-encoded) leaves a short
tail, because `url_basic_auth` anchors on the first `@` to avoid over-matching a
valid `host/path@…`; and a query value that is itself a baseline-shaped secret
(e.g. `?token=Bearer <jwt>`) is redacted twice, inflating the match `count`.
