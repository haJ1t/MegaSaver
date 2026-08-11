# @megasaver/policy

## 2.1.0

### Minor Changes

- a3ee0af: On-demand core (wave-4 3/3): daemonless one-shot worker from standalone bundle for read-only commands. Closed allowlist gate in policy, `mega.config.json {core:"on-demand"}` + flag precedence, single-shot spawn with bounded framing and SIGTERM→KILL, same core/content-store read path, gate before spawn. TDD 5+3+3+4 tests, pnpm verify green.

## 2.0.0

### Major Changes

- ab4d04c: Reject `deny.write` in `.megasaver/permissions.yaml` instead of silently
  ignoring it.

  `deny.write` compiled into `ProjectPermissions.denyWritePatterns`, and nothing
  in the repo ever read that field — there is no `evaluatePathWrite` to pair with
  `evaluatePathRead`, and live write enforcement was scoped out by
  `docs/superpowers/specs/2026-06-03-permissions-yaml-design.md` §5.4. The result
  was a security policy whose YAML presented `write:` as a peer of `read:` and
  `commands:`, both of which are enforced, while it denied nothing.

  The inconsistency this closes: the same `deny:` object already failed closed on
  a _misspelled_ key (`deny.execute` → `PolicyLoadError`) while accepting a
  correctly-spelled, entirely inert one. A typo screamed; a dead rule was silent.

  **Breaking — migration.** A `permissions.yaml` that declares `deny.write` now
  fails closed: `mega output exec`, `mega output file`, `mega output filter`, and
  the MCP `read_file` / `run_command` / `search_code` tools all return
  `policy_load_failed` until the key is removed. The error names the key and says
  what to do:

  ```
  deny.write is not enforced: Mega Saver has no write gate, so these globs would
  never deny anything. Remove the deny.write key; use deny.read / deny.commands,
  which are enforced.
  ```

  Delete the `write:` block. Nothing is lost — those globs denied nothing before
  this release, so no write that was previously blocked becomes permitted.

  `ProjectPermissions` no longer declares `denyWritePatterns`. `denyReadPatterns`,
  `denyCommands`, and every evaluator are unchanged.

  `mega output exec` (`@megasaver/cli`, patch) stopped dropping the
  `policy_load_failed` detail. It printed only
  `error: command_denied: policy_load_failed`, so on the surface most likely to
  hit a bad permissions file the operator could not tell an unenforceable key from
  a YAML syntax error. The detail now rides after the code —
  `error: command_denied: policy_load_failed: <reason>` — which keeps the
  CLI/MCP code parity that motivated the original omission. Applies to every
  `policy_load_failed` cause, not just `deny.write`.

  Major rather than minor: a previously-valid config file is now rejected and a
  public type field is removed. Both are breaking and must be visible at release.

  When a real write gate lands, `write:` returns to the schema _with_ a call site
  behind it. See
  `docs/superpowers/specs/2026-07-25-deny-write-honest-rejection-design.md`.

### Minor Changes

- 193e757: Close the three carrier gaps §5b disclosed and left open. Twelve shapes that
  measured `fired: (none)` now redact.

  `findings[].name` gains `slack_webhook_url`. It is a grouping key in
  `pro-analytics/src/firewall-report.ts`, so this is a public-surface addition —
  consumers keying on the name set see one more group.

  **Slack webhook URLs.** `https://hooks.slack.com/{services,workflows,triggers}/…`
  is itself the credential; `slack_token` cannot reach it, as it carries no
  `xox`/`xapp` prefix. A separate detector rather than a widening, and it runs
  **immediately after `jwt`, ahead of every prefix detector** — its body class
  holds `-` and `_`, so `sk-`/`xoxb-`/`npm_` can occur inside a real token, and a
  prefix hit there inserts `[`, stopping the run and leaking the characters before
  it. Only the path after `…/services/` is matched, so host and endpoint kind stay
  readable for report grouping.

  **GitLab prefixes.** Seven of the thirteen documented prefixes were missing and
  each measured `fired: (none)`: `glrtr glft glffct glimt glsoat glagent glwt`.
  Enumerated, not `gl[a-z]{2,6}-` — the wildcard matches `global-` plus 20 token
  characters, and `global-configuration-manager-x` is ordinary in a build log.

  **Connection strings.** Three bounded `\s{0,8}` gaps now cover `; Password=`,
  `Password = value` and the `;\n` form that pretty-printed `appsettings.json` and
  Azure portal output actually produce. Quoted alternatives cover the legal ADO.NET
  form `Password="p;w;d"`, which previously fired **nothing at all** — the body saw
  `"pw`, three characters, under the 8-char floor, so there was no match to
  shorten and the whole password leaked including the segment before the first
  delimiter.

  The gaps are bounded, not `\s*`: an unbounded-variable-length lookbehind is the
  shape the superlinear change removed. Growth per doubling stays linear —
  `x2.03` / `x2.07` / `x2.06` / `x2.03` / `x2.03` across the five seeds at
  512 KB → 4 MB (`node scripts/redos-probe.mjs carriers`). The `\s{0,8}` gaps cost
  1.6x on a benign 200 KB build log: 0.52 → 0.82 ms.

  The quoted run's bound is 8192, matching the password bound `url_basic_auth`
  already carries. Sweeping 4096 / 8192 / 16384 / 65536 showed the bound is
  **cost-free** — 4.7–4.9 ms at 2 MB, growth x1.98–2.03, benign 0.65–0.70 ms,
  indistinguishable — so the choice is only which failure you prefer: too small
  leaks a long `;`-bearing quoted value, too large lets a malformed unterminated
  quote over-redact up to the bound.

  Still open, recorded rather than left to be rediscovered: a quoted value over
  8192 chars **with an interior `;`** (and if that `;` sits within the first 8
  characters, nothing fires at all); `Password` followed by nine or more spaces;
  `_gitlab_session=` (a cookie, not a prefixed token); `Pwd=` (collides with the
  universal `PWD`, already settled). An unterminated quote **over**-redacts to the
  next quote, taking the following field name with it — malformed input, and
  erring toward redacting more is the safe direction for a secret.

  `scripts/redos-probe.mjs` had drifted from the shipped table: its
  `connection_string_secret` row still carried the `pwd` field that was dropped
  from production, so that row was measuring a regex that does not ship. Fixed,
  and the new `carriers` mode refuses to print a growth ratio when 1-min load
  exceeds 0.75 × cores.

- 20bf90d: Match path globs with a linear NFA instead of a compiled regex.

  `compileGlob` built a `RegExp` from untrusted glob text. The wildcard
  translations were ambiguous, so chained wildcards backtracked exponentially —
  and not only in the `**/` form first reported: `*a`x5 against a 255-character
  path measured 58,529 ms. Separately, every character other than `*`, `?` and `.`
  was emitted into the regex body unescaped, so a glob was a partially-interpreted
  regex: the zero-wildcard `(a+)+b` is itself a ReDoS at 1,130 ms on 28
  characters, and an ordinary deny rule `**/a+b.txt` silently failed to match
  `x/a+b.txt`.

  End to end, a `.megasaver/permissions.yaml` carrying a crafted `deny.read` glob
  drove `evaluatePathRead` to burn ~6 s and then return `allowed: true`. The same
  matcher backs `ProjectRule.appliesTo` ranking in `@megasaver/core`, where a
  single hostile rule cost 70 s.

  Matching is now an NFA simulation over a boolean reachability frontier advanced
  once per token, so no backtracking exists by construction — O(tokens x path
  length). Every character that is not `*`, `**`, `**/` or `?` is matched
  literally.

  Linear is not the same as bounded, so glob length, glob count and command count
  are each capped at 256 in `.megasaver/permissions.yaml`; exceeding a cap is a
  `PolicyLoadError`, never a silent trim. Bracket expressions (`[abc]`) are
  **rejected** rather than reinterpreted: they are genuine glob syntax that the
  regex honoured, so silently reading them as literal characters would narrow the
  deny set with no operator signal.

  **Security fix, previously unclaimed:** the old `**/` translation `(?:.*/)?`
  relied on `.`, which in a non-`s`-flag JS regex does not match a line
  terminator. Any path carrying `\n`, `\r`, U+2028 or U+2029 in a directory
  segment therefore bypassed 13 of the 15 baseline secret-path entries — all
  legal POSIX filename bytes. The NFA matcher has no such carve-out, and the
  bypass now has regression tests.

  **API change:** `compileGlob` returns `PathMatcher` (`{ test(path): boolean }`)
  rather than `RegExp`, and `PathMatcher` is newly exported.
  `ProjectPermissions.denyReadPatterns` / `denyWritePatterns` are retyped to
  match. All in-repo call sites used only `.test()` and are unaffected.

  Verdicts for the LOCKED §9a denylist are unchanged, pinned by a frozen fixture
  table plus 60,000 randomized comparisons against the previous implementation,
  with generators chosen for measured non-vacuity.

- 25b23b8: Fix a quadratic ReDoS in the `jwt` redaction detector and recover the
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

  **Coverage reduction — read this.** A JWT preceded directly by a _raw_
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

- ddd86a7: Make seven super-linear redaction patterns linear, and stop the firewall ledger
  depending on those patterns' bounds for containment.

  `redact()`, `redactWithFindings()` and `redactForLedger()` run over arbitrary
  tool output under a 4 MB cap, and truncation happens _after_ redaction, so the
  cap never protected the regex engine. Growth per input doubling, before → after
  (reproduce with `node scripts/redos-probe.mjs timing`):

  | pattern             | before                 | after               |
  | ------------------- | ---------------------- | ------------------- |
  | `aws_secret_key`    | ×3.95, 9,711 ms/100 KB | ×2.10, 0.16 ms      |
  | `api_key_header`    | ×3.62, 5,309 ms        | ×1.98, 0.15 ms      |
  | `basic_auth_header` | ×4.32, 4,121 ms        | ×1.68, 0.18 ms      |
  | `db_url`            | ×3.99, 6,070 ms        | ×1.03, 3.86 ms      |
  | `url_basic_auth`    | ×3.98, 970 ms          | ×1.99, 237 ms       |
  | `private_key_block` | ×4.11, 147 s at 4 MB   | ×2.19, ~7 s at 4 MB |
  | `email`             | ×3.75, 4,962 ms        | ×2.06, 14 ms        |

  Two mechanisms. `aws_secret_key`, `api_key_header` and `basic_auth_header` gained
  a first-character **lookahead guard** before their lookbehind — semantically
  inert, since each guard's class is exactly the set of first characters its body
  can match, so it prunes doomed start positions without dropping a match
  (verified over 986,880 exhaustive first-character cases and 900,000 seeded
  trials, 0 divergences). It relies on V8 evaluating assertions left to right,
  which is an engine property, not a spec guarantee; the timing tests fail with
  ~200x margin if that ever changes. `db_url`, `url_basic_auth`,
  `private_key_block` and `email` gained **bounds**.

  **Coverage reduced above the bounds** — hence minor, not patch: a `db_url` or URL
  userinfo password over 8192 characters, a `db_url` username over 256 (mitigated:
  `url_basic_auth` catches it as a fallback), and a PEM private-key body over
  32768 characters _between the markers, newlines counted_ — which with real
  64-column wrapping is ~23.6 KB of raw key material. `email` bounds only its local
  part; an over-long local part makes the match start later rather than fail, so no
  address is lost, and bounding the domain instead has a total-loss shape.

  Two bound values were rejected on measurement before 8192: 256 leaves a JWT
  password in cleartext, and 2048 leaves a ~2.5 KB JWE-shaped token and a ~2.2 KB
  AWS RDS IAM auth token in cleartext. Both are opaque to the `jwt` detector, which
  is why a JWS test fixture masks the problem.

  **`redactForLedger` also gains two ledger-only scrubbing passes.** Bounding
  `email`'s local part removed an accidental backstop: the previously unbounded
  local part had been swallowing entire URL passwords before they could reach a
  ledger `sourcePath` label, so without this an over-bound password persisted up to
  99% of itself into a store that documents itself as value-free by construction.
  Containment no longer depends on the agent-path bounds, and is cliff-free — 0
  password characters persist at any length.

  **`private_key_block` also gains two header formats it never matched.**
  `[A-Z ]+` required at least one character between `BEGIN ` and `PRIVATE KEY`, so
  unlabelled **PKCS#8** (`-----BEGIN PRIVATE KEY-----` — what `openssl genpkey`
  emits and what GCP service-account keys carry, arguably the most common modern
  form) never redacted, and both PGP private-key headers failed: **`PGP PRIVATE KEY
BLOCK`** on the trailing ` BLOCK`, and **`PGP SECRET KEY BLOCK`** because the
  noun is `SECRET`. GnuPG's armour table has three key-block headers, not two. A
  2,400-character PKCS#8 key passed `redactWithFindings` with `findings: []` and
  landed verbatim in the firewall ledger. Pre-existing in the locked baseline.

  The widening has a real cost, since these shapes were previously non-matching and
  are now genuine start positions. At the 4 MB cap, isolated, idle box: PKCS#8 goes
  3.3 ms → 6,976 ms and PGP 3.6 → 4,818 ms. The figure that matters for
  availability is the ceiling, since an attacker picks the best seed — and the
  pre-existing labelled seed already sat there, so the ceiling moves 5,760 →
  6,976 ms, **+21%**, not 3x. All growth ×1.97–2.10, linear, each pinned.

  Two over-redactions are accepted and disclosed: text quoting _both_ markers (a
  PEM parse error, prose describing the format) is now consumed. Requiring a
  newline after the BEGIN marker would avoid that and was rejected — GCP
  service-account JSON carries the key with literal `\n` escapes, not real
  newlines. `PGP PUBLIC KEY BLOCK` differs from the private form by one word and is
  pinned as a must-not-match, as are mismatched BEGIN/END labels in both
  directions.

  **`private_key_block`'s label became a grouped expression rather than a
  character class**, which took coverage from 7 to 32 of the labels ending in
  `PRIVATE KEY` in OpenSSL's own PEM table — the whole NIST post-quantum set
  (`ML-DSA-*`, `ML-KEM-*`, twelve `SLH-DSA-*`), every modern curve, `SM2`,
  `RSA-PSS`, and `X9.42 DH`. The obvious simplification is the dangerous one: a
  permissive `[A-Za-z0-9. -]*` class covers every character of
  `-----BEGIN A PRIVATE KEY-----`, so the label swallows the input and goes
  quadratic (×7.13, 1,148 ms at 16 KB). Requiring each `.`/`-` to sit between
  alphanumerics keeps the cost at roughly the old narrow class.

  **Four new detectors** cover private keys that are not PEM-armoured and that
  `private_key_block` therefore cannot reach at any label width:
  `ssh2_private_key_block` (RFC 4716 four-dash), `putty_private_key` (`.ppk`),
  `age_secret_key`, and `jwk_private_key`. These add four names to `findings[]`,
  which is public surface. The JWK detector is gated on `kty` appearing in the
  same object — an ungated `"d":"…"` matched 2 of 3 benign JSON objects in
  measurement — and uses a lookahead so `kty` and `d` may appear in either order.

  **Nine further detectors cover credential carriers that are not key files at
  all**: `aws_session_token`, `json_secret_field` (gcloud refresh tokens, Azure
  client secrets, docker registry `auth`, GCP `private_key_id`), `netrc_password`,
  `npm_token`, `pypi_token`, `vault_token`, `ansible_vault`, `bip32_xprv`, and
  `base64_pem_block`.

  `base64_pem_block` is the notable one: `kubectl get secret -o yaml` and
  kubeconfig carry a whole private key base64-wrapped, so no armour marker ever
  appears and no PEM detector can see it. It is detectable without a
  decode-and-rescan step because `-----BEGIN ` sits at offset 0, making base64
  alignment deterministic — but the shared prefix alone is not enough, since every
  armour begins that way and matching on it redacted base64-wrapped certificates
  and public keys. The label is therefore spelled in base64 across the three phase
  alignments.

  `aws_secret_key` also gained the `i` flag. That is a coverage fix, not style:
  `AWS_SECRET_ACCESS_KEY=<40 chars>` unquoted — the form a `.env`, `printenv` or CI
  log actually contains — matched nothing, because the lookbehind literal is
  lowercase (the ini form) and `env_value` requires quotes.

  Two coverage holes in previously-untouched §5a rows are fixed alongside:
  `aws_access_key` spelled only `AKIA`, so a complete `aws sts assume-role`
  credential set (access key + secret key + session token) produced `findings: []`
  and reached the ledger verbatim — `ASIA` is the temporary prefix. And
  `github_token` could not match `github_pat_`, the fine-grained form and GitHub's
  own recommended default, because the character after `gh` is `i`.

  `redactForLedger`'s userinfo scrub also excluded `/`: a URL's authority ends at
  the first slash, so real userinfo can never contain one. Without that it matched
  the last `@` anywhere and destroyed the host of every credential-free URL with
  `@` in its path — `@scope/pkg`, `@babel/core`, `@2x.png` — which is the one field
  the firewall report groups by, and cost 2,274 ms per 100 KB against 0.6 ms now.

  `aws_secret_key`, `aws_access_key`, `github_token`, `db_url` and
  `private_key_block` are §5a lock-table entries; that table is amended in the same
  commit and the three with ambiguous escaping are pinned byte-for-byte by tests.

### Patch Changes

- 07a4e3d: Apply the secret-path denylist to command arguments, not just to read paths.

  `evaluateCommand` checked the command name and the rendered command line, never
  the individual args. `ALLOWED_COMMANDS` holds five file-reading commands (`cat`,
  `find`, `grep`, `ls`, `tail`), so every exec surface read exactly the paths the
  read gate refuses — the denylist was one tool call wide.

  Measured against the real orchestrator (`runOutputExecCommand` from
  `@megasaver/context-gate`, real `spawn`, real `filterOutput`, real `.env` on
  disk):

  | call                                                                                                                           | before                                                                                                             | after                                                |
  | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
  | `grep -r -n --include=.env -e = .` (the exact vector `buildGrepArgs` emits for `proxy_search_code({include_globs: [".env"]})`) | `ok: true`, excerpt `./.env:1:AWS_SECRET_ACCESS_KEY=… ./.env:2:DB_PASSWORD=… ./.env:3:STRIPE_LIVE=…`, 0 redactions | `command_denied` / `secret_path_read`, never spawned |
  | `cat .env` (`mega_run_command`)                                                                                                | `ok: true`, full file body                                                                                         | `command_denied` / `secret_path_read`, never spawned |
  | `grep -r -n --include=*.ts -e const .`                                                                                         | `ok: true`                                                                                                         | `ok: true` (unchanged)                               |

  `runOutputPipeline({path: ".env"})` denied the same file with
  `secret_path_read` throughout, so this closed a bypass of an already-enforced
  gate. Redaction was no backstop: `redactWithFindings` over that grep output
  returns `count: 0` — the `./.env:1:` prefix defeats the `^`-anchored `env_value`
  detector, and `aws_secret_key`'s lookbehind is lowercase-only.

  Each arg is now evaluated by `evaluatePathRead`, along with the tail after a
  `=` so a flag-attached glob (`--include=<glob>`) is seen. Project `deny.read`
  globs apply to args too, so a tightened `permissions.yaml` covers exec as well
  as read. Only the LOCKED §9a denylist can deny, so an arg must look like a
  secret path to be rejected.

  Fixed once in the shared sink: `mega output exec`, `mega bench`,
  `proxy_search_code`, `mega_run_command`, the daemon `/exec` and
  `/exec-registry` handlers, and the overlay exec twin all route through
  `evaluateCommand`.

  This is an input gate. Content that a recursive `grep -r . ` sweeps out of a
  denied file it was never handed is an output-side concern and remains out of
  scope (2026-07-08 context-firewall spec non-goal).

- d270c93: Close the home credential-store leak on both layers.

  `resolveSafeReadPath` admits `homedir()` as a sandbox root, so the LOCKED
  secret-path denylist is the only thing between an agent and every credential
  file under `$HOME` — and it did not list them all. Five globs appended
  (`**/.pgpass`, `**/pgpass.conf`, `**/.docker/config.json`, `**/.kube/config`,
  `**/.config/gh/hosts.yml`), taking the table from 19 to 24. All three consumers
  of `evaluatePathRead` are fixed by that one amendment: the read gates,
  `evaluateCommand`'s arg scan (`cat ~/.pgpass` was ALLOWED) and
  `handoff-export`'s hunk filter.

  Three redaction detectors appended for the same carriers arriving by another
  route — `npmrc_auth`, `pgpass_line`, `kubeconfig_token`. All file-level globs
  and bounded patterns; `.kube/cache`, `.docker/daemon.json` and
  `.config/gh/config.yml` stay readable.

  `npmrc_auth` also matches the QUOTED value `npm config set` writes (its ini
  serializer quotes anything containing `=`, i.e. base64 padding) — without that
  the `~/.npmrc` line the detector exists for was skipped entirely, which is the
  whole reason `.npmrc` is allowed to stay off the denylist. `pgpass_line` and
  `kubeconfig_token` now gate on value SHAPE and anchor to end of line, so they
  no longer destroy ordinary colon-delimited log lines or `token:` fields in
  source code.

  No public API change.

- 07a4e3d: fix(policy): bound four quadratic redaction patterns

  `redactWithFindings` grew 3.8x-4.7x per doubling on ordinary input — column-padded
  tables, tab-indented logs and identifier blobs — because four detectors carried an
  unbounded run followed by a required literal. Measured per pattern at 50 KB ->
  100 KB: `aws_secret_key` 2.2 s -> 9.4 s, `basic_auth_header` 1.9 s -> 8.4 s,
  `api_key_header` 1.3 s -> 7.6 s, `email` 6.0 s -> 23.1 s. Every agent-visible
  output path routes through this sink with no size cap ahead of it.

  Bounded: the trailing `\s` run of the three lookbehind detectors (`{0,64}` /
  `{1,64}`), and the `email` observer's local part (`{1,64}`, RFC 5321's limit).
  Each bound is verified load-bearing on its own. Behaviour is unchanged for every
  real shape; the two disclosed divergences are a key/value separated by more than
  64 whitespace characters and an email local part longer than 64 characters, both
  pinned by test.

- 0ad461a: Short-term wave gap closure — cache-churn, session-mesh, mistake-airlock (10 tasks, consolidation supersedes 3 drafts).

  Closes the plan↔code gaps found 2026-08-10 across the three short-term improvement waves — no new invention, only wiring, bug fixes and hardening (TDD + `pnpm verify` green):

  - **`@megasaver/stats` canonical CacheChurn** — replace toy `0.05/0.8` constants with real `invalidatedCount/totalEvents` rate, `bytes/4`→`deltaTokens` pricing via `INPUT_PRICE_PER_MTOK_USD`, threshold table `bypass_compression (>0.5 && avgSavingRatio<0.2)` / `increase_floor (>0.3 && len≥5)` / `keep_enabled`, empty guard, `perTool` breakdown.
  - **`@megasaver/cli` `mega cache-doctor` (free) + `mega audit --cache` alias** — thin adapter over `analyzeCacheChurn` with injectable `readEvents`, `--json` → `CacheChurnResult`, `--store` override; no entitlement gate.
  - **`@megasaver/gui` `GET /api/stats/cache-churn`** — live handler `readEvents→analyzeCacheChurn` alongside the existing static `0.94` cache status.
  - **`@megasaver/daemon` `SessionMeshHub` IPC** — `net.createServer` on `~/.megasaver/mesh.sock` (0600, `withFileLock` race-safe, `chmod 0600` on start, unlink on stop), 200 ms connect timeout → silent disk fallback, Windows `\\.\pipe\megasaver-mesh` branch, heartbeat `Map<agentId,Memo>` + NDJSON broadcast (`memory_added|task_step_completed|gotcha_discovered|handoff_ready`).
  - **`@megasaver/mcp-bridge` `mesh_broadcast`/`mesh_query` + `get_applicable_rules` airlock merge** — Zod strict schemas under `Record<McpToolName>` compile lock; `get_applicable_rules` now returns `{ rules, airlockRules }` via lazy `readRules(storeRoot,sessionId)`.
  - **`@megasaver/core` `airlock-ledger` + `mistake-synthesizer` harden** — `appendRule/readRules/pruneExpired/clearRules` atomic JSONL (`tmp+fsync+rename` + `withFileLock`, `isSafeKeySegment`, TTL 3600 fail-closed, expired filtered on read), `escapeRegExp` + anchored `^tool(?:\s+.*)?--flag(?:\b|$)` pattern (ReDoS-safe).
  - **`@megasaver/policy` TTL + try/catch** — `evaluateCommand` now takes `airlockRules?: readonly AirlockNegativeRule[]` + `now?: number`; expired rules skipped via `Date.parse+ttl*1000<now`, broken regex swallowed with `try/catch`, word-boundary enforced.
  - **`@megasaver/cli` `mega firewall airlock list/clear` + `mega session mesh status/log`** — ledger-backed and mesh-backed thin adapters (`--json` everywhere, `--store`/`--session`/`--tail`).
  - **Bug fixes** — `mcp-bridge/server.ts` missing `storeRoot` wiring for airlock; `cli/firewall.ts` citty parent double-output (upsell over `[]`).

- Updated dependencies [ad32371]
  - @megasaver/shared@1.3.1

## 1.2.2

### Patch Changes

- Updated dependencies [5695012]
  - @megasaver/shared@1.3.0

## 1.2.1

### Patch Changes

- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
  - @megasaver/shared@1.2.0

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
