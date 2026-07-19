# Redaction Baseline Extension — Design

- **Date:** 2026-07-19 (revised 2026-07-20 after the CRITICAL design gates)
- **Status:** user-approved design (3 scope decisions + design approval
  recorded 2026-07-19). Architect pass **REVISE** and security-reviewer
  pass **REVISE** applied 2026-07-20 — 7 BLOCKING, 6 MAJOR, 3 MINOR
  findings integrated, including the removal of the prefix pre-filter
  (measured 3× pessimization), a ReDoS fix, and a false exclusion claim.
  Security re-check of this revision pending before `writing-plans`.
- **Risk:** CRITICAL (§12 — evidence-preserving redaction core). Every
  redaction sink consumes `REDACTION_PATTERNS`: the proxy output path,
  `mega output exec`, the saver/guard/intent hooks, brain export, hot
  handoff, the firewall ledger, and the GUI bridge. Mandatory chain: HIGH
  chain + `omc:tracer` evidence loop + `security-reviewer` + verifier with
  reproduction evidence + this manual user-confirmation record. Worktree
  required; `autopilot`/`ralph`/any unsupervised loop forbidden.
- **Origin:** the Hot Handoff (i10) final adversarial critic proved seven
  common credential formats survive redaction and reach a git-committed
  `AGENTS.md` via `mega handoff open`. Not an i10 regression — the same
  exposure exists in `mega brain export` and every other sink, because the
  gap is in the shared LOCKED baseline.

## 1. Problem

`packages/policy/src/redaction-patterns.ts` carries the LOCKED §9d
baseline: 19 redacting detectors plus one count-only observer (`email`,
matched and counted but never rewritten). It covers `ghp_`, `sk-ant-`,
`sk-`, AWS `AKIA`, bearer/JWT, PEM blocks, `env_value`, db URLs,
URL/CLI/header contextual secrets, and Luhn/IBAN/TCKN PII.

It misses credential formats that are ubiquitous in 2026 developer
environments. Three findings reshaped the original list:

**The existing `openai_key` rule cannot match the current OpenAI format.**
`/sk-[A-Za-z0-9]{20,}/` requires 20+ alphanumerics immediately after
`sk-`. Every current OpenAI key is `sk-proj-…` / `sk-svcacct-…` /
`sk-admin-…`, where the class breaks on the hyphen after four characters.
The detector returns no match at all and the whole key survives.

**The existing `github_token` rule matches nothing on current GitHub App
tokens.** GitHub changed the installation-token format in April 2026 to
`ghs_<app id>_<JWT>`. `/gh[pousr]_[A-Za-z0-9]{36,}/` dies at the
underscore after the app id. This is a live gap today, independent of the
seven formats that prompted the work.

**The existing `private_key_block` rule cannot match a bare PKCS#8
header.** `-----BEGIN [A-Z ]+PRIVATE KEY-----` requires at least one
character between `BEGIN ` and `PRIVATE KEY-----`, so `-----BEGIN PRIVATE
KEY-----` — the header in every Google service-account JSON — never
matches. RSA/EC/DSA/OPENSSH/ENCRYPTED variants do. This is a defect in an
existing LOCKED detector, found while auditing an exclusion claim (§7).

## 2. Goal and invariant

Extend the baseline so common cloud-credential formats are redacted at
every sink, without over-redacting legitimate developer content.

**The safety invariant, stated precisely** (an earlier draft claimed
"bit-identical existing behavior", which §6 contradicts by construction):

> No existing detector's regex, replacement, or `validate` changes, and
> the relative order among existing entries is unchanged — with one
> deliberate, separately-tested exception: `private_key_block`'s qualifier
> becomes optional to fix the PKCS#8 defect (§1, §4d).
>
> New detectors are interleaved ahead of the generic contextual rules,
> which **intentionally reassigns some matches** from `openai_key`,
> `env_value`, `api_key_header`, and `cli_secret_flag_*` to
> provider-specific names. Redaction coverage is a strict superset;
> finding names and output bytes are **not** identical.

Concretely: `NPM_TOKEN="npm_<36>"` today yields `NPM_TOKEN="[REDACTED]"`
with `findings=[{name:"env_value"}]`; after this change it yields
`NPM_TOKEN="npm_[REDACTED]"` with `findings=[{name:"npm_token"}]`. That
reassignment is the point of §6.4, and §9.7 tests it explicitly.

Success criteria:

1. Each new detector redacts a real-shaped synthetic token of its format.
2. The full pattern set produces **zero** matches against a persisted
   corpus of realistic non-secret developer text.
3. Every existing policy test passes unmodified.
4. No public identifier gains a redaction rule.
5. No detector exhibits super-linear time on adversarial input.

## 3. Scope decisions (user, 2026-07-19; approach revised 2026-07-20)

1. **Breadth:** the seven confirmed formats plus the common formats of the
   same class, in one chain — but landed in three risk-tiered commits
   (§11), not one.
2. **`sk-proj-`:** a separate additive detector, not a widening of the
   existing `openai_key` class.
3. **UX disclosure:** in scope (§8).
4. **Approach:** plain additive detectors. *(The originally-approved
   variant added a literal-prefix pre-filter for throughput. The architect
   pass measured it at 3.07×–3.43× **slower** across 16 KB–1 MB: V8's
   Irregexp already applies a Boyer-Moore start-substring fast path in C++
   to a literal-anchored regex, so `String.includes` is a second full scan
   layered on top, not a replacement. It also created a silent-divergence
   class — a regex edited without its `prefix` field yields a detector
   that never runs, i.e. a leak with no failing test. Removed. The
   absolute cost it was meant to address is 27.8 ms for the full
   50-detector set over 1 MiB of realistic text, which is noise on every
   sink.)*
5. **Context-gated low-confidence rules:** included, with an indicator
   lookbehind that is **case-insensitive and left-bounded**, plus a
   trailing lookahead (§4b).
6. **Public-identifier rescue layer:** NOT built (§7).

## 4. Detectors

Every regex is the post-gate form. Seven were corrected during format
research after a false-positive harness run; the security gate then found
six more defects, corrected here. All compile with `g`, consistent with
the existing baseline.

**Boundary discipline (applies to every detector below).** A detector
whose match ends in a bounded quantifier MUST carry a trailing negative
lookahead over the same class. Without it a token longer than the cap is
truncated and the tail stays in cleartext — a partial redaction that still
leaks. The security gate measured 6–16 surviving secret characters across
eight detectors that lacked this.

**Accepted trade-off of that discipline.** The guard converts an
over-cap token from a *partial* match into a *total* non-match: a bare
token longer than its cap now gets zero redaction where it previously got
partial redaction. This was measured non-reachable for every current
format — each cap clears its real shape with headroom (a real
`sk-proj-<74>T3BlbkFJ<74>` key is 164 B against a 317 B break; Azure 40 B,
HuggingFace 40 B, SendGrid 69 B, Stripe 107 B all match in full) — and
inside an env-var container `env_value` still catches the value. It is
recorded here rather than left implicit, because a future provider
lengthening a token is the one path that makes it real, and the fix then
is to raise the cap, not to drop the guard.

### 4a. Prefix-anchored, high confidence

| name | pattern |
|---|---|
| `stripe_live_secret_key` | `\bsk_live_[A-Za-z0-9]{24,247}(?![A-Za-z0-9])` |
| `stripe_test_secret_key` | `\bsk_test_[A-Za-z0-9]{24,247}(?![A-Za-z0-9])` |
| `stripe_restricted_key` | `\brk_(?:live\|test)_[A-Za-z0-9]{24,247}(?![A-Za-z0-9])` |
| `openai_project_key` | `\bsk-(?:proj\|svcacct\|admin)-[A-Za-z0-9_-]{20,150}T3BlbkFJ[A-Za-z0-9_-]{20,150}(?![A-Za-z0-9_-])` |
| `google_api_key` | `AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])` |
| `google_oauth_client_secret` | `GOCSPX-[A-Za-z0-9_-]{28}(?![A-Za-z0-9_-])` |
| `slack_bot_token` | `xoxb-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24,34}(?![A-Za-z0-9])` |
| `slack_user_token` | `xox[pe](?:-[0-9]{10,13}){3}-[A-Za-z0-9]{28,34}(?![A-Za-z0-9])` |
| `slack_legacy_workspace_token` | `xox[ar]-(?:\d-)?[0-9A-Za-z]{8,48}(?![0-9A-Za-z])` |
| `slack_legacy_token` | `xox[os]-\d+-\d+-\d+-[a-fA-F0-9]{16,64}(?![a-fA-F0-9])` |
| `slack_app_token` | `xapp-\d-[A-Z0-9]{9,13}-\d{10,13}-[a-f0-9]{64}(?![a-f0-9])` |
| `slack_app_config_token` | `xoxe(?:\.xox[bp])?-\d-[A-Za-z0-9]{140,170}(?![A-Za-z0-9])` |
| `slack_webhook_url` | `https:\/\/hooks\.slack\.com\/(?:services\|workflows\|triggers)\/[A-Za-z0-9+\/]{43,56}(?![A-Za-z0-9+\/])` |
| `github_fine_grained_pat` | `github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}(?![A-Za-z0-9])` |
| `github_app_token` | `\bghs_[0-9]{1,12}_eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` |
| `npm_token` | `npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])` |
| `sendgrid_api_key` | `\bSG\.[A-Za-z0-9_-]{20,24}\.[A-Za-z0-9_-]{39,50}(?![A-Za-z0-9_-])` |
| `datadog_app_key` | `ddapp_[A-Za-z0-9]{34}(?![A-Za-z0-9])` |
| `gitlab_routable_token` | `glpat-[0-9a-zA-Z_-]{27,300}\.[0-9a-z]{2}[0-9a-z]{7}(?![0-9a-zA-Z])` |
| `gitlab_pat` | `glpat-[0-9a-zA-Z_-]{20}(?![0-9a-zA-Z_-])` |
| `gitlab_trigger_token` | `glptt-[0-9a-zA-Z_-]{40}(?![0-9a-zA-Z_-])` |
| `gitlab_runner_registration_token` | `GR1348941[0-9a-zA-Z_-]{20,50}(?![0-9a-zA-Z_-])` |
| `huggingface_token` | `\bhf_[a-zA-Z0-9]{34,40}(?![a-zA-Z0-9])` |
| `huggingface_org_token` | `\bapi_org_[a-zA-Z0-9]{34}(?![a-zA-Z0-9])` |
| `digitalocean_pat` | `dop_v1_[a-f0-9]{64}(?![a-f0-9])` |
| `digitalocean_oauth_token` | `doo_v1_[a-f0-9]{64}(?![a-f0-9])` |
| `digitalocean_refresh_token` | `dor_v1_[a-f0-9]{64}(?![a-f0-9])` |
| `azure_client_secret` | `(?<![a-zA-Z0-9_~.-])[a-zA-Z0-9_~.]{3}\dQ~[a-zA-Z0-9_~.-]{31,34}(?![a-zA-Z0-9_~.-])` |

Three shapes need their reasoning recorded, because the naive form of
each is wrong:

- **`openai_project_key` — bounded runs are mandatory, not stylistic.**
  The watermark `T3BlbkFJ` (base64 of `OpenAI`) is itself inside the
  character class of the run that precedes it, and so is `-`, so
  `sk-proj-` is class material too. With an unbounded `{20,}` every
  `sk-proj-` occurrence becomes a backtracking start position: measured
  48.6 ms at 20 KiB rising to 12,319 ms at 313 KiB, a clean 4× per
  doubling. Bounding both runs to `{20,150}` gives 13.3 ms at 313 KiB
  (~900×) and still claims a real-shaped key in full. Anchoring on the
  watermark rather than exact segment lengths is what avoids the ~14%
  miss rate that exact-length pinning shows on real tokens.
- **`github_app_token` — anchored to the real format.** GitHub's own
  recommendation (`ghs_[A-Za-z0-9.\-_]{36,}`) is unanchored and admits
  dots and dashes, so it matches ordinary identifiers and file paths:
  `ghs_handler_registry_for_the_whole_application_module` matches in
  full, and `src/ghs_internal.helpers.for-tests-and-fixtures-only.ts`
  matches through the file extension. The real shape is
  `ghs_<numeric app id>_<JWT>`, which is what this pattern requires.
- **`azure_client_secret` — the leading guard is a lookbehind, not a
  consumed character.** A consuming boundary would be replaced along with
  the secret.

### 4b. Context-gated, low confidence

No distinctive prefix; the indicator lookbehind is what makes these safe.
Three properties are mandatory on each, and the security gate proved each
one load-bearing:

- **Case-insensitive (`i`).** The canonical real-world shape of all three
  is an uppercase environment variable. Case-sensitive lookbehinds leaked
  7 of 8 canonical shapes — `TWILIO_AUTH_TOKEN=<32 hex>`,
  `DD_API_KEY=<32 hex>`, `export DD_API_KEY=…`, the docker-compose
  `  TWILIO_AUTH_TOKEN: <32 hex>` form — with **no detector firing at
  all**, because `env_value` requires a quoted value and these shapes are
  conventionally unquoted.
- **Left-bounded indicator.** Without it the indicator matches as a
  substring of an unrelated token and the detector redacts a benign hash:
  `add_app_key: <sha1>` matched via `dd_app_key:`, and
  `odd-api-key = <md5>` via `dd-api-key`.
- **Trailing lookahead.** Stops a longer hex run being truncated into a
  false match.

| name | pattern |
|---|---|
| `twilio_auth_token` | `(?<=(?:^\|[^A-Za-z0-9])(?:twilio[_-]?)?auth[_-]?token["'\s:=]{1,10})[0-9a-fA-F]{32}(?![0-9a-fA-F])` — flags `gi` |
| `datadog_api_key` | `(?<=(?:^\|[^A-Za-z0-9])(?:dd\|datadog)[_-]?api[_-]?key["'\s:=]{1,10})[a-f0-9]{32}(?![a-f0-9])` — flags `gi` |
| `datadog_app_key_legacy` | `(?<=(?:^\|[^A-Za-z0-9])(?:dd\|datadog)[_-]?app(?:lication)?[_-]?key["'\s:=]{1,10})[a-f0-9]{40}(?![a-f0-9])` — flags `gi` |

`datadog_app_key_legacy` matches exactly the shape of a git SHA-1. It is
entirely dependent on its context gate and must never be relaxed to run
unanchored.

### 4c. Dropped during the security gate

**`mailgun_private_key`** (`\bkey-[a-f0-9]{32}`) is removed. It is an
over-redaction rule, not a credential rule: `key-` followed by 32
lowercase hex is the shape of any identifier suffixed with an MD5, which
is everywhere in ordinary developer output. The harness found **360 hits
over a 4,543-line non-secret corpus** — `cache key-<md5> hit`,
`memcached: key-<md5> ttl=300`, `s3://bucket/key-<md5>.json`,
redis `DEL key-<md5>`. §7 already concedes Mailgun's current-generation
key is undetectable, so the legacy form is a small win for a large cost.

### 4d. One existing detector is fixed

`private_key_block` becomes:

```
-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z]+ )*PRIVATE KEY-----
```

The qualifier becomes optional so bare PKCS#8 (`-----BEGIN PRIVATE
KEY-----`) matches — the header in every Google service-account JSON. All
currently-covered variants (RSA, EC, DSA, OPENSSH, ENCRYPTED) continue to
match; the `[\s\S]` body class is retained so a PEM collapsed onto one
line with escaped newlines still matches. This is the single deliberate
exception to the §2 invariant, and it carries its own before/after test.

### 4e. Replacements

Each replacement preserves the format's identity so the agent keeps the
debugging signal — `sk_live_[REDACTED]`, `AIza[REDACTED]`,
`xoxb-[REDACTED]`, `github_pat_[REDACTED]` — matching the existing
convention (`gh*_[REDACTED]`, `sk-ant-[REDACTED]`). The security gate
verified that no replacement string re-matches another detector or
collides with the `MEGA_SAVER_BLOCK_*` / handoff sentinels.

## 5. Architecture

No architectural change. `RedactionPattern`, `redactWithFindings`,
`redact`, and `redactForLedger` are untouched; the work is entries in the
existing ordered table plus the §4d fix. See §3.4 for why the originally
proposed pre-filter was removed.

## 6. Ordering

Application order is load-bearing: a broader pattern running first steals
the match from a narrower one, and a shorter one can leave a partial
secret in cleartext.

**Placement:** the entire new prefix-anchored block (§4a) runs **before
every existing detector**, in the order listed. The context-gated block
(§4b) runs immediately after it, still ahead of the existing entries. The
existing 19 keep their current relative order.

Binding pairwise rules, each with a test in §9.3:

1. **`gitlab_routable_token` BEFORE `gitlab_pat`.** Reversed, the classic
   `{20}` rule bites the first 20 characters off a routable token and
   leaves the remaining ~23 — including the CRC — in cleartext.
2. **`github_app_token` BEFORE the existing `jwt`.** A `ghs_` token
   embeds a JWT; with `jwt` first the finding is labelled `jwt`, the
   `ghs_<app id>_` prefix survives in cleartext, and `github_app_token`
   never fires.
3. **`slack_webhook_url` BEFORE `db_url` and `url_query_secret`,** so the
   finding is labelled as a Slack webhook.
4. **New detectors BEFORE the generic contextual rules** (`env_value`,
   `api_key_header`, `cli_secret_flag_*`), so a recognized credential is
   labelled by provider rather than by container. This is the deliberate
   reassignment described in §2.
5. **`openai_project_key` BEFORE `openai_key`** — defensive only. The
   existing `sk-` rule provably cannot match a project key today (that is
   the §1 gap); the ordering keeps provider labelling stable if either
   character class is later widened.
6. **Existing relative order preserved** — `anthropic_key` still precedes
   `openai_key`, `db_url` still precedes the generic URL rules.

Order is enforced structurally as well as behaviorally (§9.3), because
five hand-picked pairs out of ~1,275 ordered pairs is not a guarantee.

## 7. Exclusions (12) — and why

**Public identifiers (5) — a redaction rule here destroys legitimate
content.** Stripe `pk_live_`/`pk_test_` (ships in every Stripe.js frontend
bundle), Twilio Account SID `AC…` and API Key SID `SK…` (the basic-auth
username; the paired token is the secret), Google OAuth client IDs,
Mailgun `pubkey-`. Twilio `AC` is disqualified twice: the harness produced
45 false positives from `AC` plus 32 hex characters appearing inside
ordinary uppercase SHA-256 digests.

No rescue layer is built. Today `STRIPE_PUBLISHABLE_KEY=pk_live_…` is
already redacted by the generic `env_value` rule, and that behavior is
unchanged. Rescuing those identifiers would need an allowlist pre-pass
over the whole text before any rule runs — new architecture on a CRITICAL
path, to change a behavior nobody has reported as a problem. Out of scope
by decision (§3.6).

**Redundant with existing detectors (3, verified).** Both OpenAI legacy
shapes (the watermarked 51-character key and the pre-watermark
48-character key) and the GitHub classic PAT are each claimed in full by
an existing detector — proven by running the existing regex against a
synthetic token of that format. *(A fourth claim, the Google
service-account PEM, was audited and found **false**; it is now the §4d
fix.)*

**Not safely detectable (4).** Google's legacy unprefixed 24-character
OAuth secret, Mailgun's current-generation key and webhook signing key,
and bare-base64 Azure keys have no stable prefix. A loose regex would
over-redact; the honest answer is that they are out of reach.

## 8. UX disclosure

`mega handoff pack`, `mega handoff open`, and `mega brain export` gain one
line stating that redaction is a regex baseline and does not catch every
provider's credential format. Defined **once** as an exported constant in
`apps/cli` alongside the other user-facing strings and referenced from all
three sites — three hand-copied sentences would drift. It stays out of
`@megasaver/policy`, which exports no user-facing strings today.

## 9. Testing

1. **Per-detector table tests.** For each detector: a real-shaped
   synthetic positive (never a real credential), plus adversarial
   near-misses — one character short, wrong charset, prefix-as-substring
   of a longer identifier, and the format embedded in a longer run to
   prove the trailing lookahead holds. Each §4b detector additionally
   asserts on the **uppercase env-var form** (`DD_API_KEY=…`,
   `export TWILIO_AUTH_TOKEN=…`, the docker-compose indented form), not
   only the lowercase shape.
2. **False-positive corpus, persisted as a fixture.** The ~4,500-line
   non-secret corpus becomes a test asset; the assertion is that the
   complete pattern set produces zero matches over it. It must include
   the specific strings the gates caught: `cache key-<md5>`,
   `s3://bucket/key-<md5>.json`, `DEL key-<md5>`, `add_app_key: <sha1>`,
   `odd-api-key = <md5>`, `ghs_handler_registry_for_the_whole_application_module`,
   `src/ghs_internal.helpers.for-tests-and-fixtures-only.ts`, and
   uppercase SHA-256 digests containing `AC`+32 hex.
3. **Ordering — behavioral and structural.** One behavioral test per rule
   in §6. Plus one structural test over the whole table: for each ordered
   pair, derive the leading literal run from `pattern.source` and assert
   that if one entry's literal is a proper prefix of another's, the more
   specific entry has the lower index. Six hand-picked pairs cannot cover
   ~1,190.

   **The derivation must read through non-capturing alternations and
   single-character classes, not stop at the first metacharacter.** The
   naive form (stop at `(` or `[`) yields four false failures that were
   measured against this exact table: `sk-` derived from
   `openai_project_key` appears to precede `sk-ant-`, and `xox` derived
   from the three Slack token rules appears to precede `xoxe`. All four
   were verified as artifacts — each format is claimed and labelled
   correctly end to end. Deriving `sk-(?:proj|svcacct|admin)-` and
   `xox[ar]-` through their groups removes the artifact without a
   whitelist.
4. **LOCKED snapshot.** A frozen inline table asserting `{name,
   pattern.source, pattern.flags, replacement, hasValidate}` for the
   original 19 — minus the single intended `private_key_block` change,
   which the snapshot records in its fixed form. This converts §2's
   safety invariant from a promise into a CI gate.
5. **ReDoS timing regression — scoped to the new tier.** Each detector
   added by this change is timed against adversarial input at four scales
   (20/39/78/156 KiB of prefix-repetition padding), asserting a generous
   wall-clock ceiling. `openai_project_key` carries the 313 KiB case
   explicitly, since that is the one measured to blow up (11.47 ms
   bounded, versus 4× per doubling unbounded).

   The ceiling deliberately does **not** cover the original 19: the
   existing `jwt` detector is already strongly super-linear — 31.1 /
   114.2 / 437.0 / 1850.2 ms at those same scales against
   `'eyJaA0'.repeat(n)`, and reachable from realistic base64-JSON log
   output (an unbroken 24.6 KiB run costs 9.93 ms, 4× per doubling). That
   is a pre-existing exposure this change neither introduces nor is
   scoped to fix, and §13 locks the detector. Applying the gate to it
   would fail CI on day one for a defect out of scope. Recorded as a
   follow-up in §14.
6. **PKCS#8 before/after.** `private_key_block` matches bare
   `-----BEGIN PRIVATE KEY-----`, a GCP service-account JSON with escaped
   newlines, and every previously-covered variant.
7. **Reassignment tests.** One case per (container rule, new detector)
   pair that §6.4 redirects — `NPM_TOKEN="npm_…"`,
   `x-api-key: <AIza…>`, `--token=xoxb-…` — asserting the new finding
   name **and** that the value is still fully redacted. This is what
   catches the dangerous version of the reassignment: a new detector that
   partially matches inside a container and leaves a cleartext tail where
   the container rule used to redact everything.
8. **Existing suites unmodified.** `redact.test.ts`, `redact-pii.test.ts`,
   `redact-unstructured.test.ts`, and `redact.property.test.ts` pass
   untouched.

## 10. Consumers

`redact`, `redactWithFindings`, and `redactForLedger` keep their exact
signatures; `RedactResult` is unchanged. `findings[]` gains new `name`
values and, per §2, some inputs are relabelled from a container rule to a
provider rule. The firewall ledger and brain export persist
`findings[].name`, so records written before and after this change may
label the same input differently; that is acceptable — the names are
descriptive, not a stable API — and is recorded here so nobody treats a
label change as data corruption.

No consumer needs a *behavioral* change. §8 adds display copy to three CLI
commands, which is the only consumer edit in this branch.

## 11. Implementation sequencing

Three commits inside one worktree and one CRITICAL chain, so the risky
detectors can be reviewed and reverted independently of the safe ones:

1. **FP corpus fixture alone**, asserted green against today's 19
   detectors. Landing the gate before the change it gates means a corpus
   failure in step 2 is unambiguously caused by a new detector, not by a
   corpus defect. This also seeds the tracer evidence loop.
2. **The 28 prefix-anchored detectors (§4a) + the `private_key_block` fix
   (§4d)** with their tests, ordering rules, LOCKED snapshot, and ReDoS
   timings.
3. **The 3 context-gated detectors (§4b)** with their uppercase env-var
   fixtures and left-boundary tests. These carry essentially all the
   remaining over-redaction risk and are the natural revert unit.

## 12. File organization

The table stays in one file and the 300-LOC convention gets a recorded
exception. It is a single ordered data table serving one concern, and its
correctness depends on the whole order being readable in one place; a
split by family is the one refactor that can silently break it, because
application order is global. The exception is stated in the module header
alongside the ordering rules.

## 13. LOCKED boundary

After this change the file has 50 detectors. The lock is redefined and
made mechanical: **the original 19 remain LOCKED verbatim** (enforced by
the §9.4 snapshot test, which also pins the one intended
`private_key_block` change), while the new provider-detector tier is
**amendable** — new formats may be added with tests, without a new epic
gate, provided the FP corpus and ReDoS timing tests stay green. The
module header states the boundary and names the snapshot test as its
enforcement, so "LOCKED" is evaluable rather than decorative.

## 14. Known follow-ups (not in scope)

**`jwt` ReDoS (live exposure in shipped code, own chain required).** The
existing `jwt` detector backtracks super-linearly: 31.1 / 114.2 / 437.0 /
1850.2 ms at 20/39/78/156 KiB against `'eyJaA0'.repeat(n)`, with one run
peaking at 7,268 ms at 78 KiB; a control on non-`eyJ` text costs 0.08 ms.
It is reachable from realistic base64-JSON log output, so every sink that
redacts agent output can be stalled by ordinary — not even adversarial —
input. Same class as the DoS fixed on the handoff path. Out of scope here
(§13 locks the detector and this change neither introduces nor touches
it), tracked separately.

Also deferred: Stripe `whsec_` webhook signing secrets; GitLab `glrt-`
runner authentication tokens (the live replacement for the deprecated
`GR1348941` format included here); Slack `xoxc-`/`xoxd-` browser session
tokens. Self-managed GitLab lets administrators change the `glpat-`
prefix entirely, so every GitLab detector here is gitlab.com-specific —
stated in the module comment.

## 15. Process

CRITICAL chain: this spec → architect pass ✅ (REVISE, integrated) →
`security-reviewer` design pass ✅ (REVISE, integrated) → **security
re-check of this revision** → `writing-plans` → worktree → TDD →
`pnpm verify` + reproduction evidence → `code-reviewer` AND `critic`
(separate passes, author ≠ reviewer) → `omc:tracer` evidence loop →
verifier. Changeset for `@megasaver/policy` and `@megasaver/cli`. Wiki:
update `entities/policy` and append to `log.md`.
