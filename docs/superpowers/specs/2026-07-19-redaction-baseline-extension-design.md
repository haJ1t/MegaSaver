# Redaction Baseline Extension — Design

- **Date:** 2026-07-19
- **Status:** user-approved design (3 scope decisions + design approval
  recorded 2026-07-19); architect + security-reviewer + tracer passes
  pending per the CRITICAL chain.
- **Risk:** CRITICAL (§12 — evidence-preserving redaction core). Every
  redaction sink in the product consumes `REDACTION_PATTERNS`: the proxy
  output path, `mega output exec`, the saver/guard/intent hooks, brain
  export, hot handoff, the firewall ledger, and the GUI bridge. Mandatory
  chain: HIGH chain + `omc:tracer` evidence loop + `security-reviewer` +
  verifier with reproduction evidence + this manual user-confirmation
  record. Worktree required; `autopilot`/`ralph`/any unsupervised loop
  forbidden.
- **Origin:** the Hot Handoff (i10) final adversarial critic proved seven
  common credential formats survive redaction and reach a git-committed
  `AGENTS.md` via `mega handoff open`. Not an i10 regression — the same
  exposure exists in `mega brain export` and every other sink, because the
  gap is in the shared LOCKED baseline.

## 1. Problem

`packages/policy/src/redaction-patterns.ts` carries the LOCKED §9d
baseline: 19 redacting detectors plus one count-only observer (`email`,
matched and counted but never rewritten). It covers
`ghp_`, `sk-ant-`, `sk-`, AWS `AKIA`, bearer/JWT, PEM blocks, `env_value`,
db URLs, URL/CLI/header contextual secrets, and Luhn/IBAN/TCKN PII.

It misses credential formats that are ubiquitous in 2026 developer
environments. A live probe confirmed these reach the rendered output
un-redacted. Two findings from the format research reshaped the original
list:

**The existing `openai_key` rule truncates on the current OpenAI format.**
`/sk-[A-Za-z0-9]{20,}/` requires 20+ alphanumerics immediately after
`sk-`. Every current OpenAI key is `sk-proj-…` / `sk-svcacct-…` /
`sk-admin-…`, where the class breaks on the hyphen after four characters.
The whole key survives.

**The existing `github_token` rule matches nothing on current GitHub App
tokens.** GitHub changed the installation-token format in April 2026 to
`ghs_<APPID>_<JWT>` (~520 characters). `/gh[pousr]_[A-Za-z0-9]{36,}/`
dies at the underscore after the app id. This is a live gap in the
baseline today, independent of the seven formats that prompted the work,
and it is the single highest-value rule in this change.

## 2. Goal

Extend the baseline so the common cloud-credential formats are redacted at
every sink, without over-redacting legitimate developer content and
without changing the behavior of any existing detector.

Success criteria:

1. Each new detector redacts a real-shaped synthetic token of its format.
2. The full pattern set produces **zero** matches against a persisted
   corpus of realistic non-secret developer text.
3. Every existing policy test passes unmodified.
4. No public identifier gains a redaction rule.
5. Redaction throughput on secret-free text does not regress.

## 3. Scope decisions (user, 2026-07-19)

1. **Breadth:** the seven confirmed formats plus the common formats of the
   same class, in one pass — the CRITICAL chain cost is fixed, so a single
   sweep amortizes it.
2. **`sk-proj-`:** a separate additive detector, not a widening of the
   existing `openai_key` class. Additive-only keeps existing behavior
   bit-identical.
3. **UX disclosure:** in scope (§8).
4. **Approach:** additive detectors plus a literal-prefix pre-filter (§5).
5. **Context-gated low-confidence rules:** included, with both a lookbehind
   indicator gate and a trailing lookahead.
6. **Public-identifier rescue layer:** NOT built (§7).

## 4. Detectors added (32)

Every regex below is the cross-checked form: seven were corrected during
review after a false-positive harness run over ~3,500 lines of realistic
non-secret text (git SHAs, uppercase SHA-256 digests, UUIDs, base64 blobs
and `data:` URIs, JWT-shaped triples, integrity hashes, npm lockfile lines,
`node_modules` paths, stack traces, minified JS). All compile with the `g`
flag, consistent with the existing baseline.

### 4a. Prefix-anchored, high confidence

| name | pattern |
|---|---|
| `stripe_live_secret_key` | `\bsk_live_[A-Za-z0-9]{24,247}\b` |
| `stripe_test_secret_key` | `\bsk_test_[A-Za-z0-9]{24,247}\b` |
| `stripe_restricted_key` | `\brk_(?:live\|test)_[A-Za-z0-9]{24,247}\b` |
| `openai_project_key` | `\bsk-(?:proj\|svcacct\|admin)-[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}\b` |
| `google_api_key` | `AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])` |
| `google_oauth_client_secret` | `GOCSPX-[A-Za-z0-9_-]{28}(?![A-Za-z0-9_-])` |
| `slack_bot_token` | `xoxb-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24,34}` |
| `slack_user_token` | `xox[pe](?:-[0-9]{10,13}){3}-[A-Za-z0-9]{28,34}` |
| `slack_legacy_workspace_token` | `xox[ar]-(?:\d-)?[0-9A-Za-z]{8,48}` |
| `slack_legacy_token` | `xox[os]-\d+-\d+-\d+-[a-fA-F0-9]{16,64}` |
| `slack_app_token` | `xapp-\d-[A-Z0-9]{9,13}-\d{10,13}-[a-f0-9]{64}` |
| `slack_app_config_token` | `xoxe(?:\.xox[bp])?-\d-[A-Za-z0-9]{140,170}` |
| `slack_webhook_url` | `https:\/\/hooks\.slack\.com\/(?:services\|workflows\|triggers)\/[A-Za-z0-9+\/]{43,56}` |
| `github_fine_grained_pat` | `github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}` |
| `github_app_token` | `ghs_[A-Za-z0-9][A-Za-z0-9._-]{34,}[A-Za-z0-9_-]` |
| `npm_token` | `npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])` |
| `sendgrid_api_key` | `\bSG\.[A-Za-z0-9_-]{20,24}\.[A-Za-z0-9_-]{39,50}(?![A-Za-z0-9_-])` |
| `mailgun_private_key` | `\bkey-[a-f0-9]{32}(?![a-f0-9])` |
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

Two shapes carry their precision in a literal watermark rather than in a
length bound, and the spec pins that deliberately:

- **OpenAI** keys embed `T3BlbkFJ` (base64 of `OpenAI`) mid-token.
  Anchoring on the watermark instead of exact segment lengths avoids the
  ~14% miss rate that exact-length pinning produces on real tokens, at no
  false-positive cost.
- **GitHub `ghs_`** follows GitHub's own recommended shape for the new
  stateless format.

### 4b. Context-gated, low confidence

These have no distinctive prefix; the indicator lookbehind is what makes
them safe, and the trailing lookahead is what stops them truncating a
longer hex run into a false match. Both are mandatory. The existing
`aws_secret_key` detector already uses this technique, so it is precedent,
not a new mechanism.

| name | pattern |
|---|---|
| `twilio_auth_token` | `(?<=(?:twilio[_-]?)?auth[_-]?token["'\s:=]{1,10})[0-9a-fA-F]{32}(?![0-9a-fA-F])` |
| `datadog_api_key` | `(?<=(?:dd\|datadog)[_-]?api[_-]?key["'\s:=]{1,10})[a-f0-9]{32}(?![a-f0-9])` |
| `datadog_app_key_legacy` | `(?<=(?:dd\|datadog)[_-]?app(?:lication)?[_-]?key["'\s:=]{1,10})[a-f0-9]{40}(?![a-f0-9])` |

`datadog_app_key_legacy` matches exactly the shape of a git SHA-1. It is
100% dependent on its context gate and must never be relaxed to run
unanchored.

### 4c. Replacements

Each detector's replacement preserves the format's identity so the agent
keeps the debugging signal: `sk_live_[REDACTED]`, `AIza[REDACTED]`,
`xoxb-[REDACTED]`, `github_pat_[REDACTED]`, and so on, matching the
existing baseline's convention (`gh*_[REDACTED]`, `sk-ant-[REDACTED]`).

## 5. Architecture — literal-prefix pre-filter

`RedactionPattern` gains one optional field:

```ts
prefix?: string;  // literal, case-sensitive
```

`redactWithFindings` skips a pattern when `prefix` is set and
`text.includes(prefix)` is false.

This cannot change behavior: a pattern whose regex requires a literal
prefix cannot match text that does not contain that prefix. It exists
because `redactWithFindings` runs every pattern over the whole text on
every call, on hot paths (proxy output, PostToolUse saver hook, handoff
open). Going from 19 to 51 redacting detectors would otherwise multiply
that scan cost; with the guard, secret-free text costs ~32
`String.includes` calls instead of 32 regex scans, so throughput improves
rather than regresses.

A detector qualifies for a `prefix` when its regex begins with a literal
run, optionally behind a zero-width `\b` — `\bsk_live_…` qualifies with
prefix `sk_live_`. The context-gated detectors (§4b), any
case-insensitive detector, and every existing baseline entry are left
alone.

Equivalence is a test obligation, not an assumption (§9).

## 6. Ordering rules

Application order is load-bearing — a broader pattern running first steals
the match from a narrower one, and a shorter one can leave a partial
secret in cleartext. Five orderings are binding:

1. **`openai_project_key` BEFORE the existing `openai_key`.** The existing
   `sk-` rule would otherwise claim part of the span and mislabel it.
2. **`gitlab_routable_token` BEFORE `gitlab_pat`.** Reversed, the classic
   `{20}` rule bites the first 20 characters off a routable token and
   leaves the remaining ~23 characters — including the CRC — in cleartext.
   A partial redaction still leaks.
3. **`slack_webhook_url` BEFORE `db_url` and `url_query_secret`,** so the
   finding is labelled as a Slack webhook rather than a generic URL.
4. **New prefix-anchored detectors BEFORE the existing generic contextual
   rules** (`env_value`, `api_key_header`, `cli_secret_flag_*`), so a
   recognized credential is labelled by provider rather than by container.
5. **Existing relative order is preserved unchanged** — `anthropic_key`
   still precedes `openai_key`, `db_url` still precedes the generic URL
   rules.

The module comment documenting the order is extended to cover these.

## 7. Exclusions (13) — and why

**Public identifiers (5) — a redaction rule here destroys legitimate
content.** Stripe `pk_live_`/`pk_test_` (ships in every Stripe.js frontend
bundle), Twilio Account SID `AC…` and API Key SID `SK…` (the basic-auth
username; the paired token is the secret), Google OAuth client IDs,
Mailgun `pubkey-` (client-side email validation). Twilio `AC` is
disqualified twice: the harness produced 45 false positives from `AC`
plus 32 hex characters appearing inside ordinary uppercase SHA-256
digests.

No rescue layer is built. Today `STRIPE_PUBLISHABLE_KEY=pk_live_…` is
already redacted by the generic `env_value` rule, and that behavior is
unchanged by this work. Rescuing those identifiers would require an
allowlist pre-pass over the whole text before any rule runs — new
architecture on a CRITICAL path, to change a behavior nobody has reported
as a problem. Out of scope by decision (§3.6).

**Redundant with existing detectors (4).** Both OpenAI legacy shapes (the
watermarked 51-character key and the pre-watermark 48-character key) are
already claimed in full by the existing `openai_key`; the proposed GitHub
classic-PAT rule is already claimed by `github_token`; the Google
service-account PEM is already claimed by `private_key_block`. Adding them
would be dead code.

**Not safely detectable (4).** Google's legacy unprefixed 24-character
OAuth secret, Mailgun's current-generation key and webhook signing key,
and bare-base64 Azure keys have no stable prefix. A loose regex for them
would over-redact; the honest answer is that they are out of reach.

## 8. UX disclosure

`mega handoff pack`, `mega handoff open`, and `mega brain export` gain one
line stating that redaction is a regex baseline and does not catch every
provider's credential format. This stays true as detectors grow, and it
matches the product's honest-metrics posture: the tool should not invite
more trust than it earns.

## 9. Testing

1. **Per-detector table tests.** For each of the 32: a real-shaped
   synthetic positive (never a real credential), plus adversarial
   near-misses — one character short, wrong charset, prefix-as-substring
   of a longer identifier, and the format embedded in a longer run to
   prove the trailing lookahead holds.
2. **False-positive corpus, persisted as a test.** The ~3,500-line
   non-secret corpus used during research becomes a fixture. The assertion
   is that the complete pattern set produces zero matches over it. This is
   the regression lock against over-redaction, and it must run against the
   whole set, not just the new entries.
3. **Ordering tests.** One test per binding rule in §6, each written so it
   fails if the order is wrong. The GitLab case asserts the full token is
   replaced, with no cleartext remainder.
4. **Prefix-guard equivalence.** `redactWithFindings` with and without the
   guard produces byte-identical output and identical findings over both
   the positive fixtures and the FP corpus.
5. **Existing suites unmodified.** `redact.test.ts`, `redact-pii.test.ts`,
   `redact-unstructured.test.ts`, and `redact.property.test.ts` all pass
   untouched — they are the regression net for the LOCKED behavior.
6. **Throughput check.** A timing assertion (generous bound, not a
   micro-benchmark) proving secret-free text does not get slower with 51
   redacting detectors than it was with 19.

## 10. Consumers — no signature changes

`redact`, `redactWithFindings`, and `redactForLedger` keep their exact
signatures. `RedactResult` is unchanged. `findings[]` gains new possible
`name` values, which is additive: every consumer treats the array as
opaque. No consumer needs a code change, and `@megasaver/policy` gains no
new dependency.

## 11. Known follow-ups (not in scope)

Stripe `whsec_` webhook signing secrets; GitLab `glrt-` runner
authentication tokens (the live replacement for the deprecated
`GR1348941` format included here); Slack `xoxc-`/`xoxd-` browser session
tokens. Self-managed GitLab lets administrators change the `glpat-` prefix
entirely, so every GitLab detector here is gitlab.com-specific — worth
stating in the module comment.

## 12. Process

CRITICAL chain: this spec → architect pass → `security-reviewer` design
pass → `writing-plans` → worktree → TDD → `pnpm verify` + reproduction
evidence → `code-reviewer` AND `critic` (separate passes, author ≠
reviewer) → `omc:tracer` evidence loop → verifier. Changeset for
`@megasaver/policy` (and `@megasaver/cli` if the §8 disclosure lands in
the same branch). Wiki: update `entities/policy` and append to `log.md`.
