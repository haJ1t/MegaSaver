---
title: Home credential stores reach the model — denylist gap + redaction gap
date: 2026-07-25
risk: CRITICAL
status: approved
branch: fix/secret-path-home-credentials
base: origin/main @ 133a95f0
owner-confirmation: >
  The repo owner requested this work in the session that dispatched it, and that
  request is the manual confirmation CLAUDE.md §12 CRITICAL requires for amending
  a LOCKED table. Recorded here, in the spec, per §12.
locked-tables-amended:
  - "§4a DENYLIST_GLOBS / SECRET_PATH_PATTERNS (packages/policy/src/secret-paths.ts)"
  - "§5a/§5b REDACTION_PATTERNS (packages/policy/src/redaction-patterns.ts) — append only"
supersedes-nothing: true
---

# Home credential stores reach the model

## §1 Problem

`resolveSafeReadPath` deliberately admits the whole home directory as a sandbox
root (`packages/output-filter/src/resolve-safe-read-path.ts:32` —
`[input.projectRoot, process.cwd(), homedir()]`). The LOCKED secret-path
denylist is therefore the only thing standing between an agent and every
credential file under `$HOME`. It does not list them all.

Two independent gaps, and fixing either alone leaves the secret reachable:

- **(a) Path gap.** `~/.pgpass`, `~/.docker/config.json`, `~/.kube/config` and
  `~/.config/gh/hosts.yml` match no glob in `DENYLIST_GLOBS`, so
  `evaluatePathRead` returns `{ allowed: true }` and both read gates pass.
- **(b) Content gap.** Even when the *path* is never read, the same bytes arrive
  by other routes — `grep` output, a pasted config, a build log, a `kubectl`
  dump. The redactor has no detector for the token formats those files use, so
  the secret is reproduced verbatim in the model's context and in the persisted
  content store.

### §1a Reproduction (against `origin/main`, HEAD `133a95f0`)

Real files written under a throwaway `$HOME`, driven through both gates and then
through the redactor:

```
LEAK     ~/.npmrc                gate=ALLOWED  findings=[]
         model sees: //registry.npmjs.org/:_authToken=<synthetic-uuid-elided>
LEAK     ~/.pgpass               gate=ALLOWED  findings=[]
         model sees: prod-db.internal:5432:payments:svc_payments:Pg-Sup3r-S3cr3t-2026
LEAK     ~/.kube/config          gate=ALLOWED  findings=[]
         model sees: token: k8s-svc-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdef
SCRUBBED ~/.docker/config.json   gate=ALLOWED  findings=[json_secret_field x1]
SCRUBBED ~/.config/gh/hosts.yml  gate=ALLOWED  findings=[github_token x1]
DENIED   ~/.netrc  ~/.git-credentials  ~/.aws/credentials  -> secret_path_read
```

Redaction coverage per carrier, isolating gap (b):

```
LEAK  ~/.npmrc  legacy uuid _authToken     count=0
LEAK  ~/.npmrc  artifactory base64 token   count=0
LEAK  ~/.npmrc  _auth (basic)              count=0
ok    ~/.npmrc  npm_-prefixed              count=1  npm_token
LEAK  ~/.pgpass line                       count=0
LEAK  ~/.kube/config  token:               count=0
ok    ~/.kube/config  client-key-data      count=1  base64_pem_block
ok    ~/.docker/config.json  auth          count=1  json_secret_field
ok    ~/.config/gh/hosts.yml oauth_token   count=1  github_token
```

`docker`/`gh` are scrubbed on content but still readable on path — the path
denial is the first line of defence, the detector is the second, and this spec
closes both for the carriers where either is missing.

### §1b Blast radius — one table, three consumers

The defect is a missing row in one table, not a missing guard at N call sites.
`SECRET_PATH_PATTERNS` is read only by `evaluatePathRead`
(`packages/policy/src/evaluate-path-read.ts:17`), and three independent
subsystems route through it:

| Consumer | Entry point |
|---|---|
| Read path (both gates) | `context-gate/src/read.ts` `runTwoGates` / `runOverlayTwoGates` → `run.ts` `runOutputPipeline`; reached by `mcp-bridge` `proxy_read_file` (`path: z.string().min(1)`, no project confinement), `daemon/src/handlers-registry.ts`, `mega output file`, `mega output filter` |
| Command path | `policy/src/evaluate-command.ts:51` — every arg and every post-`=` tail of an allow-listed command. `cat` is allow-listed, so `cat ~/.pgpass` was ALLOWED |
| Export path | `core/src/handoff-export.ts:70` `pathAllowed` — hunk-level drop on `mega handoff pack` |

One table amendment fixes all three. No per-caller guard is written.

`proxy_search_code` / `proxy_expand_chunk` do not call `runOutputPipeline` and
are out of scope.

### §1c What already landed, and what the report got wrong

Judged against `133a95f0`, not the `07a4e3dc` named in the dispatch:

- `5e221055` (#309) already amended the LOCKED denylist with `**/.netrc`,
  `**/_netrc`, `**/.pypirc`, `**/.git-credentials` — four of the reported
  carriers are closed. `.npmrc` was considered and **deliberately excluded**,
  with the reasoning committed into `secret-paths.ts`. §3b keeps that decision.
- `#309`/`#311` landed half the second layer: `json_secret_field` reaches
  docker's `"auth"`, `base64_pem_block` reaches kubeconfig `client-key-data`,
  `github_token` reaches `gho_`, `netrc_password` and `url_basic_auth` reach
  `.netrc` and `.git-credentials`. Gap (b) is narrower than filed.
- The report's "content store at mode 0644" claim is **dead**:
  `packages/content-store/src/atomic-write.ts:36-38` now writes `0o600` inside a
  `0o700` directory. The at-rest half of the impact is closed; the in-context
  half is not, and that is the half this spec fixes.
- The realpath re-gate in `gateAround` is orthogonal — it re-runs the *same*
  denylist on the resolved path, and a glob that was never in the table is still
  absent on the second pass.

### §1d New defect found while reproducing — table drift

Not in the original report:

- `packages/policy/test/glob-equivalence.test.ts:36` **hand-copies**
  `DENYLIST_GLOBS` and still holds the pre-#309 fifteen entries. The four globs
  #309 shipped are untested by it and it does not fail, because it only
  cross-checks two glob compilers against its own private list.
- `docs/superpowers/specs/2026-05-10-bb3-policy-design.md` §4a still prints the
  fifteen-glob table and the line "15 patterns" while the code ships nineteen.
  The #309 amendment is recorded only in `wiki/log.md` and the commit body,
  never in the LOCKED table it amends.

This is the drift class `133a95f0` (#313) had just fixed for
`scripts/redos-probe.mjs` — same defect, adjacent file, missed. Left alone, this
fix makes it worse: the table goes to twenty-four and both copies stay at
fifteen. §3d and §3e close it.

## §2 Non-goals

- Removing `homedir()` from the gate-2 sandbox roots (see §4, rejected).
- Confining `proxy_read_file`'s `path` to the project root.
- Content that a recursive `grep -r .` sweeps out of a file it was never handed —
  an output-side concern, an explicit non-goal of the 2026-07-08 context-firewall
  spec, and unchanged here.
- Detectors for secrets with no distinguishing shape (Twilio Auth Token, etc.).

## §3 Approach

### §3a LOCKED §4a amendment — five globs appended (gap (a))

Appended to `DENYLIST_GLOBS`, taking the table from 19 to 24:

```
**/.pgpass
**/pgpass.conf
**/.docker/config.json
**/.kube/config
**/.config/gh/hosts.yml
```

**Why these and not their directories.** The discriminator is *does this exact
filename ever carry ordinary, non-credential config?*

| Glob | Format | Collateral |
|---|---|---|
| `**/.pgpass` | `host:port:db:user:password`, credentials only, by definition | none |
| `**/pgpass.conf` | the Windows spelling of the same file (`%APPDATA%\postgresql\pgpass.conf`); the repo ships full Windows support, and `normalizePath` already folds `\`→`/` | none |
| `**/.docker/config.json` | holds `auths[].auth` (base64 `user:password`) | `.docker/daemon.json`, buildx state and contexts stay readable |
| `**/.kube/config` | holds `users[].user.token` / `client-key-data` | `.kube/cache/**` stays readable |
| `**/.config/gh/hosts.yml` | holds `oauth_token` | `.config/gh/config.yml` (editor, aliases, protocol) stays readable |

`**/.docker/**`, `**/.kube/**` and `**/.config/**` are rejected in §4.

**`pgpass.conf` is the one glob without a leading dot**, so it can match a
project file named `pgpass.conf`. That file is a pgpass file wherever it lives;
the denial is correct there too.

### §3b `.npmrc` stays out of the denylist

#309's recorded reasoning is unchanged and is not re-litigated: a project
`.npmrc` is ordinary pnpm settings (this repo's own is four lines of
`auto-install-peers` and friends), and `evaluatePathRead` invariant I1 means a
baseline denial has **no un-deny field** — denying it blinds the agent to
ordinary config with no appeal. The residual npmrc credential is closed on the
redaction side by §3c's `npmrc_auth`, which is where #309 said it belonged.

Raised again by the 2026-07-26 review, which was right that the rationale was
falsified as shipped — `npmrc_auth` did not match the quoted form npm actually
writes — and re-rejected on the remedy: the falsified thing was the detector,
not the placement. `**/.npmrc` would deny this repo's own four-line settings
file with no un-deny, so §3c fixes the detector instead. This is a decision
about which side of the two-gate design owns the file, and it does not change
if the detector is later found wanting again; a broken detector is a bug in the
detector.

### §3c LOCKED §5a/§5b amendment — three detectors appended (gap (b))

`redact()` applies each pattern through a **replacer function**
(`packages/policy/src/redact.ts:22`), so `$1` in a replacement string is
returned literally, not expanded. Capture-group replacements are therefore not
available, and all three detectors use the established house shape: a
first-character lookahead start guard in front of a bounded lookbehind
(`concepts/lookahead-start-guard`), value run bounded
(`concepts/unbounded-run-redos`).

All three are **appended** to the end of `REDACTION_PATTERNS`. Nothing is
reordered, no existing row's bytes change — the §5a ordering constraint
(`jwk_private_key` and `jwt` run before every prefix detector) is preserved, so
this is the HIGH-tier append shape, not the CRITICAL edit shape. It still
carries `.source` pins, `.flags` pins, floor/ceiling fixtures and growth-ratio
measurement, as every §5a change must.

| name | pattern | replacement |
|---|---|---|
| `npmrc_auth` | `(?=\S)(?<=_(?:authtoken\|auth\|password)[ \t]{0,8}=[ \t]{0,8}["']?)[^\s"']{8,4096}` `gi` | `[REDACTED]` |
| `pgpass_line` | `(?=\S)(?<=^[^\s:]{1,253}:\d{1,5}:[^\s:]{1,64}:[^\s:]{1,64}:)(?:\\[^\r\n]\|[^\s:\\]){1,512}(?=[ \t]{0,8}$)` `gm` | `[REDACTED]` |
| `kubeconfig_token` | `(?=\S)(?<=^[ \t]{0,32}(?:token\|id-token\|refresh-token):[ \t]{1,8})[A-Za-z0-9._~+/=-]{16,4096}(?=[ \t]{0,8}$)` `gim` | `[REDACTED]` |

**Revised 2026-07-26 after review.** The three rows above are the second
version. The first shipped a leak and two evidence-destruction defects, all
three reproduced against the branch before being fixed:

1. `npmrc_auth` could not match a QUOTED value, and npm's ini serializer
   `JSON.stringify()`s any value containing `=` — base64 padding, i.e. most
   real `_auth`/Artifactory `_authToken` values — so the quoted spelling is
   what `npm config set` writes. `[^\s"']` cannot consume the opening `"` and
   the lookbehind no longer holds one position later, so the canonical
   tool-written line was skipped ENTIRELY, not truncated. Since §3b keeps
   `.npmrc` off the denylist on the argument that this detector covers it,
   that argument was false as shipped. Fixed by consuming an optional quote
   inside the lookbehind, which is what `json_secret_field` already does.
2. `pgpass_line`'s `[^\r\n]{1,512}` value ate the rest of any line clearing the
   port gate — `12:34:56:789:request completed ok`, an expanded IPv6 address,
   `CACHE:8080:web:nginx:restarting now`. The numeric port is not rare. Both
   over-redaction fences the first version added had a NON-numeric second
   field, so they passed vacuously and fenced nothing.
3. `kubeconfig_token`'s 16-character floor is not a discriminator — every
   identifier expression clears it, and `token: z.string().min(1),` in this
   repo's own `packages/daemon/src/discovery.ts:8` was being destroyed. The
   evidence-preservation negatives only tested SHORT values, so they too
   passed with or without the floor.

Both (2) and (3) are the `PWD=` class, and `filterOutput` redacts before
chunking and persists only the redacted raw, so the deleted bytes were not
recoverable through `mega output chunk`. Fixed by gating on value SHAPE and
anchoring the value to end of line: a `.pgpass` password is the LAST field and
cannot contain an unescaped `:`, and a kubeconfig token is a YAML scalar.

Notes that are load-bearing, not decoration:

- **`npmrc_auth`** gates on the leading `_`, which is what makes it npm-shaped
  rather than the word "auth". It covers the three formats `npm_token` misses:
  legacy UUID `_authToken`, Artifactory base64 `_authToken`, and `_auth`
  (base64 `user:password`). Floor 8 keeps `_auth=` placeholders out.
- **`pgpass_line`** matches the fifth field of a five-field record. The
  lookbehind requires the four preceding fields *including a numeric port*, which
  is what stops it firing on an ordinary `a:b:c:d:e` line. It is line-anchored via
  `^` under `m` and deliberately does **not** use `^\s*` — `\s` matches `\n`,
  which is ReDoS instance 7 in `concepts/unbounded-run-redos`.
- **`kubeconfig_token`** gates on line-start indentation (`[ \t]{0,32}`, again not
  `\s`) plus a 16-character floor, so `token: yes` and `token: 5` in prose or a
  count column do not fire. The JSON form `"token": "..."` cannot reach it (the
  `"` breaks the line-start gate) and is not added to `json_secret_field`, whose
  field list is an existing row and therefore a CRITICAL-tier edit.

**Disclosed losses**, recorded now rather than rediscovered:

- `npmrc_auth`: a value containing a space or an EMBEDDED quote is truncated
  there; a value over 4096 characters keeps its tail.
- `pgpass_line`: a password over 512 characters is missed ENTIRELY — the
  end-of-line anchor cannot be reached, so there is no truncation to fall back
  on; a password beginning with a space is missed (the `(?=\S)` guard); a
  pgpass line whose port field is non-numeric (`*` wildcard) is missed — `*` is
  legal in pgpass and this is a real, accepted hole, chosen over widening the
  port field to `[^\s:]{1,5}`, which would fire on any five-colon line.
- `kubeconfig_token`: a token under 16 characters is missed; a token in flow
  style (`{token: x}`) is missed; a token over 4096 characters is missed
  ENTIRELY, same end-of-line reason as `pgpass_line`; a token followed by an
  inline `# comment` is missed.
- `kubeconfig_token` residual OVER-redaction, accepted rather than fixed: a
  bare identifier alone on the line (`token: authorizationHeaderValue`) is
  byte-identical to a real YAML scalar and nothing in the text separates them.
- Shared: `jwt`'s greedy `[A-Za-z0-9_-]+` segment runs earlier and can swallow a
  following indicator when the two are glued by base64url characters — the
  already-documented §5a cost, unchanged by this append.

### §3d Delete the hand-copied denylist, do not test it

`glob-equivalence.test.ts` gets `DENYLIST_GLOBS` **imported** from
`../src/secret-paths.js` (newly exported from the module; **not** added to the
package's public `index.ts`, so §2's LOCKED public surface is untouched).
The hand-copy is deleted.

The equivalence oracle stays: the frozen pre-fix `legacyCompileGlob` is still
the thing the live compiler is checked against. What changes is that it is
checked over the *shipped* list instead of a private snapshot of it.

A **non-vacuity** assertion is added: every glob in the table must be matched by
at least one path in the test's `PATHS` corpus. Without it, importing the live
list silently makes a new glob's equivalence check vacuous — the same trap
`redos-probe-parity.test.ts` guards against, and the reason the existing copy
failed to notice #309.

### §3e Pin the spec table to the code

A new test parses the fenced glob block out of §4a of
`docs/superpowers/specs/2026-05-10-bb3-policy-design.md` and asserts it equals
`DENYLIST_GLOBS`, in order. §4a and its "15 patterns" line are updated to the
twenty-four shipped globs plus an amendment record naming #309 and this spec.

`redos-probe-parity.test.ts` already reaches out of the package to
`../../../scripts/`, so a test reading a repo-root doc is established practice
here. This is the enforcement §5b's follow-up F1 notes is missing for the
redaction table; it is applied to §4a only, which is the table this spec amends.

### §3f `scripts/redos-probe.mjs`

The three detectors get rows in the probe's `NEW_DETECTORS`, which
`redos-probe-parity.test.ts` then pins byte-for-byte against the shipped table.
A detector added without a probe row is unmeasured, and unmeasured is how this
repo has reintroduced the ReDoS class ten times.

## §4 Alternatives rejected

1. **Drop `homedir()` from `resolveSafeReadPath`'s sandbox roots.** The most
   tempting fix — it is *why* home dotfiles are reachable at all. Rejected: gate
   2 is structural containment in a different package, and `$HOME` is load-bearing
   for the product's own premise (`mega connector sync` writes `~/.claude/**`,
   `~/.codex/**`, `~/.cursor/**`, and agents legitimately read them back). It
   also has no un-deny appeal, and it does **nothing** for gap (b). If home
   confinement is ever wanted it needs its own spec with an opt-in root list, not
   a deletion smuggled into a leak fix.
2. **Directory globs `**/.docker/**`, `**/.kube/**`, `**/.config/**`.** Rejected
   for exactly the reason #309 excluded `.npmrc`: a baseline denial cannot be
   un-denied (I1), so a wide glob permanently blinds the agent to ordinary config
   — `.kube/cache`, `.docker/daemon.json`, and under `.config` essentially
   everything. Narrow file globs cost one line each and lose nothing.
3. **Deny `**/.npmrc` after all.** Rejected: §3b.
4. **Guard at the call sites** — reject the path in `proxy_read_file`, in
   `evaluateCommand`, in `handoff-export`. Rejected: three copies of one rule,
   and the fourth consumer added next month gets none of them. All three already
   route through `evaluatePathRead`; that is the choke point and it is where the
   fix goes.
5. **A `redos-probe`-style parity test for the hand-copied `DENYLIST_GLOBS`**
   (the literal #313 move). Rejected in favour of deleting the copy. #313 could
   not delete its copy — the probe legitimately holds *superseded* patterns that
   must differ from what ships. `glob-equivalence.test.ts` has no such reason: it
   needs the live list. A test that detects drift is strictly worse than an
   import that makes drift impossible.
6. **Widen `json_secret_field` / `netrc_password` instead of adding rows.**
   Rejected: editing an existing row's pattern is a CRITICAL-tier amendment under
   §5a's scope paragraph, re-opens measured bounds that were paid for, and risks
   the ordering constraint. Appending is the HIGH-tier shape and is additive by
   construction.
7. **An entropy / length heuristic instead of named carriers.** Rejected: the
   `PWD=` incident. A heuristic that redacts `PWD=/Users/x/proj` destroys evidence
   in exactly the stream this redactor filters, against the stated non-goal.
8. **Fix only gap (a).** Rejected explicitly by the dispatch and by the
   reproduction: the path denial does nothing when the same bytes arrive from
   `grep`, a paste, or a log.

## §5 What this could regress, and the test that catches it

| Regression | Catching test |
|---|---|
| An over-broad glob blinds the agent to ordinary config | `evaluate-path-read.test.ts` negatives: `.kube/cache/http/x`, `.docker/daemon.json`, `.config/gh/config.yml`, project `.npmrc`, `pgpassword.txt` must stay `allowed: true` |
| The command gate now denies benign commands (`ls ~/.kube/`) | `evaluate-command.test.ts`: `cat ~/.pgpass` denied `secret_path_read`; `ls ~/.kube` and `cat ~/.docker/daemon.json` still allowed |
| `handoff-export` silently drops hunks it should carry | `handoff-export` test: a `.kube/config` hunk dropped, a `.kube/cache` hunk kept |
| A new detector destroys evidence (the `PWD=` class) | negative fixtures: `token: yes`, `token: 42`, `PWD=/Users/x/p`, a four-field `a:b:c:d` line, a URL `host:8080:x:y:z` in prose, `"token": "..."` JSON, `--auth=` under 8 chars |
| A new detector reintroduces the ReDoS class | growth-ratio rows in `redact-superlinear.test.ts` (n vs 4n, ratio ceiling), red-proved by unbounding the run; probe rows in `scripts/redos-probe.mjs` |
| A detector's bytes drift from spec/probe | `.source` + `.flags` pins; `redos-probe-parity.test.ts` (existing, now covering three more rows) |
| The denylist and its copies drift again | `glob-equivalence.test.ts` imports the live list + non-vacuity assertion; new §4a-vs-code parity test |
| Ordering constraint broken by the append | existing `redact-jwt-order.test.ts` plus a table-position assertion that the three new rows are last |
| `count` under-reports (missing `/g`) | `.flags` pins on all three |

Residual risk accepted: `pgpass_line` misses the `*` wildcard port form, and all
three detectors inherit `jwt`'s documented swallow. Both are disclosed in §3c
rather than fixed, because fixing either requires editing a locked row.

## §6 Definition of done

`pnpm verify` green; the §1a reproduction re-run showing `gate=DENIED` for the
four new path carriers and `count>=1` for the three new content carriers;
`code-reviewer` **and** `critic` passes (CRITICAL, §12); `security-reviewer`
pass; changeset; §4a + §5b updated in the same commit as the code; wiki
`entities/policy` + `log.md` updated.
