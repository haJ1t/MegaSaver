# @megasaver/policy

## 1.2.0

### Minor Changes

- 0a3256b: Fix three bugs surfaced by a full feature-test pass.

  - `rules apply --files` now matches `appliesTo` glob patterns. Matching
    used a plain `startsWith` prefix check, so globs like `*.ts` /
    `**/*.ts` never matched any path — the `--files` filter silently
    returned nothing. It now compiles globs through the policy
    `compileGlob` engine (newly exported from `@megasaver/policy`) while
    keeping the literal directory-prefix behaviour (`src/db/`).
  - `mega output file|filter|exec` now surface the secret-redaction
    warning (`redacted N secret(s) before processing`) in text mode. The
    warning was produced and stored in the result but only visible via
    `--json`, hiding a security-relevant signal from CLI users.
  - `mega index show <project> <bad-id>` now reports
    `invalid block id "<value>"` for a malformed block id instead of the
    misleading `name must be non-empty`.

- b2e39cd: Extend the secret detector to catch contextual (no-prefix) secrets. `redact()`
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

### Patch Changes

- Updated dependencies [7fcd881]
- Updated dependencies [fde8e86]
- Updated dependencies [4be82f8]
- Updated dependencies [f7cbc28]
- Updated dependencies [12c8e9e]
- Updated dependencies [f7bb136]
- Updated dependencies [ed46198]
- Updated dependencies [00bd97e]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0

## 1.1.0

### Minor Changes

- bb3d179: Add project permissions (`.megasaver/permissions.yaml`) support to the policy gate.

  New public API: the pure `parseProjectPermissions(raw: unknown): ProjectPermissions`
  (zod `.strict()` validation + glob compilation, no fs/yaml — zero new runtime
  deps), its `projectPermissionsSchema`, the compiled `ProjectPermissions` type, and
  the typed `PolicyLoadError`. `evaluateCommand` and `evaluatePathRead` each gain an
  optional `permissions?: ProjectPermissions` applied as an additional, tighten-only
  deny gate after the baseline chain (a `deny.commands` match → `command_not_allowed`;
  a `deny.read` glob match → `secret_path_read`). The `policyDenyCodeSchema` closed
  enum gains a seventh member, `policy_load_failed` (alphabetic, between `path_denied`
  and `recursive_megasaver`), emitted by the orchestrator on a present-but-malformed
  file.

  Tighten-only by construction: there is no `allow:` key and no field that subtracts
  from a baseline list, so a project file can only ADD denials — it can never
  re-allow a `DANGEROUS_PATTERNS` hit, add to `ALLOWED_COMMANDS`, or un-deny a
  `SECRET_PATH_PATTERNS` entry. Invalid shape (incl. a stray `allow:` or any unknown
  key) throws `PolicyLoadError` — fail-closed, never a silent ignore.

## 1.0.0

### Major Changes

- b7f35e3: Mega Saver v1.0 — Context Gate / Mega Saver Mode.

  Session-scoped, GUI-controlled, MCP-backed output compression ships
  complete: the `tokenSaver` session setting, the Context Gate
  orchestrator, the output-filter redaction/ranking pipeline, the
  content store, retrieval (BM25) and stats packages, the real
  `@megasaver/mcp-bridge` over stdio with four tools, the GUI
  TokenSaverPanel + Agent Setup Doctor, and the additive
  `MEGA SAVER:CONTEXT_GATE` connector instruction block. One click
  enables token saving per session; raw evidence stays local; the agent
  receives only the most relevant excerpts with measurable byte savings.

### Minor Changes

- 61efb28: Add the `@megasaver/policy` security gate package: `evaluateCommand`
  (allow-list + dangerous-pattern + `MEGASAVER_ORIGIN_PID` re-entry guard),
  `evaluatePathRead` (secret-path denylist), `redact` (baseline secret
  redaction), and the closed alphabetic `policyDenyCodeSchema` /
  `PolicyDenyCode` enum.

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [b7f35e3]
- Updated dependencies [0498b79]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
