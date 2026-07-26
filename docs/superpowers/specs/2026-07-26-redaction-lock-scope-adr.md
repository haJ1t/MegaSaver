# ADR — what the §5a redaction lock covers

- **Date:** 2026-07-26
- **Status:** accepted
- **Risk:** MEDIUM (record and process only; no regex, no code change)
- **Supersedes:** nothing. **Amends:**
  `docs/superpowers/specs/2026-05-10-bb3-policy-design.md` §5a (heading, scope
  paragraph, new §5b).
- **Decision:** **Option 2 — the lock covers the original ten and now says so**,
  with one correction: the amendment tier is keyed to **what the change does**,
  not to which table the row lives in.

## Placement

This repo has no ADR directory. The existing convention is *ADR-as-section*:
`2026-05-10-bb3-policy-design.md` §10 is titled "Alternatives considered (ADR)",
and every dated spec under `docs/superpowers/specs/` carries its rejected
alternatives inline. This decision spans four specs and governs future ones, so
it gets its own dated file in `docs/superpowers/specs/` rather than being buried
in one of them. Per the task instruction: that location is the fallback, chosen
because no ADR convention exists to follow.

---

## 1. Context — the measured state, 2026-07-26

§5a calls itself "REDACTION_PATTERNS baseline (epic §9d — LOCKED for BB3)" and
says "The 10 baseline entries". Reviewers flagged that the lock is not
enumerable: "a lock nobody can enumerate is not a lock", and "the next author
has no way to tell which rows are locked."

Read off `packages/policy/src/redaction-patterns.ts` and the two pin tests on
this date:

| | count |
|---|---|
| `REDACTION_PATTERNS` (agent-visible, rewrites text) | 32 |
| `OBSERVED_PATTERNS` (count-only observer, `email`) | 1 |
| rows named in §5a | 10 |
| rows shipped but not named in §5a | 23 |

Provenance of the 23:

| source | rows |
|---|---|
| `2026-07-08-context-firewall-design` | `credit_card`, `iban`, `tr_national_id`, `email` (observer) |
| `2026-07-25-redaction-superlinear-patterns-design` §3e | `jwk_private_key`, `ssh2_private_key_block`, `putty_private_key`, `age_secret_key` |
| `2026-07-25-redaction-superlinear-patterns-design` §3f | `aws_session_token`, `json_secret_field`, `netrc_password`, `npm_token`, `pypi_token`, `vault_token`, `ansible_vault`, `bip32_xprv`, `base64_pem_block` |
| commit `b2e39cdf` (2026-06-17, PR #150) — **no dated spec exists** | `url_basic_auth`, `url_query_secret`, `cli_secret_flag_eq`, `cli_secret_flag_spaced`, `api_key_header`, `basic_auth_header` |

Two facts that change the shape of the decision:

**(a) Pin coverage does not follow the lock boundary.** Exact
`RegExp.source` equality pins: **5 of the 10 lock rows**, **20 of the 30
post-lock rows**. `flags` pins: **6 of 10** and **24 of 30**. Four rows in the
supposedly-locked ten carry *neither* pin — `anthropic_key`, `openai_key`,
`bearer_token`, `env_value` — while ten post-lock rows carry both. `jwt` has a
`startsWith` prefix pin in `redact-jwt.test.ts`, not a full byte pin, even
though §5a footnote ‡ records its exact bytes.

The predictor of rigor is therefore **"has a dated spec amended this row since
2026-07-19"**, not "is it one of the ten". The split in
`redact-superlinear.test.ts` ("§5a lock-table rows" vs "post-lock detector
bytes") reads as a policy but is really a record of provenance — its own comment
says the post-lock rows "need the same byte-exactness for the same reason", and
gives them the same treatment. The implicit answer already in the test is Option
2 for *bookkeeping* and Option 1 for *rigor*.

**(b) The tiering already exists, undocumented in §5a.**
`2026-07-25-redaction-superlinear-patterns-design` §0 assigns three tiers:
CRITICAL for `aws_secret_key`/`db_url`/`private_key_block` because they are §5a
rows, HIGH for `api_key_header`/`basic_auth_header`/`url_basic_auth` as
"post-lock additions", MEDIUM for the `email` observer. So the most recent
CRITICAL-risk change in this area *already operated Option 2*. §5a simply never
stated it, which is the whole complaint.

**(c) Record drift runs both ways.** `2026-07-19-redaction-baseline-extension-design`
(status: user-approved design, security re-check pending) specifies roughly
twenty-eight vendor detectors — `stripe_*`, `google_api_key`, `slack_*`,
`gitlab_*`, `huggingface_*`, `digitalocean_*`, `azure_client_secret`,
`sendgrid_api_key`, `datadog_app_key`, `github_app_token`, `slack_webhook_url`
— **none of which are in the shipped table**. `npm_token` and `pypi_token` were
designed there with different bytes (`{36}` with a trailing negative lookahead)
and shipped later by the 07-25 spec as `{30,}`. A reader cannot currently tell
"specced and shipped" from "specced only" from "shipped with no spec" for any
row. All three states exist.

---

## 2. Options

### Option 1 — the lock covers all rows; every row gets byte pin + CRITICAL amendment

**For.** Highest uniform safety. No boundary to argue about, so no row can be
quietly treated as second-class. It matches what the test file already does for
byte pins, and it would have caught the four unpinned lock rows.

**Against, and decisive:**

1. **It inverts the observed failure mode.** Every leak this table has actually
   suffered was *missing or too-narrow coverage*, never a bad addition:
   unlabelled PKCS#8 (`findings: []`, a 2,400-character key reached the ledger
   verbatim), `ASIA` temporary STS credentials, `github_pat_`, and unquoted
   `AWS_SECRET_ACCESS_KEY=` matching nothing. All four are recorded in §5a's own
   footnotes as *pre-existing in the baseline as locked*. Taxing additive
   coverage with the full CRITICAL chain — `architect` + `omc:tracer` evidence
   loop + `security-reviewer` + verifier with reproduction evidence + manual
   user confirmation in the spec — raises the cost of the one action that has
   repeatedly been the fix. Process that makes the historical fix expensive and
   the historical failure free is pointed the wrong way.
2. **It contradicts the locked text it claims to enforce.** §5 says BB5 "may
   extend the pattern list via changeset (epic §9d — new patterns are LOW-risk
   follow-ups)". Option 1 does not tighten the lock; it rewrites a locked
   division of labour without saying so.
3. **CRITICAL is defined, and this is not it.** `CLAUDE.md` §12 reserves
   CRITICAL for cryptographic operations, deleting user data, mutating user
   repos, licence code, incident response. A detector that only ever replaces
   more bytes with `[REDACTED]` is HIGH ("evidence-preserving compression",
   "connector core path"). §12's anti-cheat rule is one-way — risk can be
   raised, never silently lowered — so mislabelling here is permanent.
4. **The friction argument is smaller than it looks, and it is not the real
   cost.** Repo-wide process discipline already requires a dated spec for every
   feature ("No 'this feature is too small for a spec'"), so "a new vendor
   prefix becomes a spec amendment" is not a cost Option 1 introduces. The
   genuine delta between Options 1 and 2 is *CRITICAL chain vs HIGH chain* —
   four extra mandatory agent passes and a manual user-confirmation record per
   added prefix. That is the thing being weighed, and per (1) it is being spent
   in the wrong place.

### Option 2 — the lock covers the original ten and says so (**chosen**)

**For.** It is already the practice (§1b), so it ratifies rather than migrates.
It makes the lock enumerable, which is the actual complaint. It leaves the
CRITICAL chain attached to the rows whose bytes have documented, measured,
adversarially-reviewed reasoning behind every character — where re-deriving that
reasoning is genuinely the expensive part — and puts additive coverage on the
HIGH chain, which still means `code-reviewer` + `critic` + byte pin + fixtures.

**Against.** Taken naively it would assert something false: that the ten are
pinned and the rest are not. Measured, four of the ten have no pin at all and
most of the rest do. If §5a shipped that framing it would violate the rule
against asserting in prose what no test checks — the failure mode this table has
been bitten by four times. The correction below is not optional to the decision.

### Option 3 — generate the record from source

**Against — agreed with the architect pass, plus two stronger reasons.**

1. The architect's point stands: a generator for one table puts the shipped
   bytes an indirection away from the locked record.
2. **It is self-defeating.** The byte pin has value *only because the record is
   written independently of the source*. Generate the record from the source and
   `expect(pattern.source).toBe(recordedBytes)` can never fail — the drift
   detector the record exists to feed is deleted by the mechanism meant to serve
   it.
3. **The load-bearing content is not in the source.** §5a's value is the part no
   generator can emit: that the `db_url` password bound was rejected at 256
   (leaves a JWT in cleartext) and at 2048 (leaves a 2.5 KB JWE and an AWS RDS
   IAM token), that the `aws_secret_key` guard **must stay in front of** the
   lookbehind because moving it produces byte-identical output and restores the
   full quadratic, that `[A-Za-z0-9. -]*` measures x7.13 growth where the
   grouped form measures x2.16, and the disclosed losses. Those are the review
   artefacts. The regex bytes are the least interesting thing in the section.

**One slice of Option 3 is adopted** — not generation, a *completeness check*:
assert that the set of shipped detector names equals the set named in the
record. That is what makes the lock enumerable by construction and stops a new
row entering the table without a record entry. It compares two independently
maintained lists, so it does not have flaw (2). Recommended as follow-up F1
below; not implemented here, since this task is record-only.

---

## 3. Decision

The §5a lock covers the **ten BB3 baseline rows** and now says so. §5b
enumerates all 23 post-lock rows with their owning spec, or records honestly
that none exists.

Amendment tier is keyed to **what a change does**, not to which table the row
sits in. Membership in the ten is a poor proxy: it produced no pin for four of
its own rows, and the worst leak class this table has had — whole JWKs and JWTs
passing through with only a prefix span redacted, reported under a benign
finding name — was caused by **order**, which is not a property of any row's
table membership.

| tier | change shape |
|---|---|
| **CRITICAL** | Editing an existing row's `pattern`, `flags`, `replacement` or `validate`. Moving any row. Inserting a row anywhere before `jwk_private_key` or `jwt`. Any change that can *reduce* coverage (the 2026-07-26 `jwt` reorder is one: see §5a ◇). Applies to all 33 rows, lock-table or not. |
| **HIGH** | Appending a new detector at a position that preserves the ordering constraint (`jwk_private_key` and `jwt` before every prefix detector). |
| **MEDIUM** | `OBSERVED_PATTERNS` changes that cannot alter agent-visible text. |

Every tier requires, without exception: a `.source` pin, a `.flags` pin, and
behavioural floor/ceiling fixtures, per the hard rules this package learned over
four review rounds. CRITICAL additionally requires amending the row's record —
§5a footnote for one of the ten, §5b row otherwise — **in the same commit**.

The CRITICAL row is where the ten still earn distinct treatment: for those ten,
"amend the record in the same commit" means editing footnotes that carry
measured timings, rejected bound values and disclosed losses, and the reviewer
is expected to check the new bytes against that reasoning. That obligation is
real and specific, and it is why the ten keep a name of their own.

---

## 4. Consequences

- §5a is renamed and given an explicit scope statement plus a pointer to §5b.
- §5b enumerates the 23 post-lock rows. It records **no pattern bytes** — those
  live in the pin tests and the owning specs. This is deliberate: the `jwt` (‡)
  and `db_url` (◆) footnotes both exist because a markdown table cell escapes
  `|` as `\|` and renders `/` plainly, so no cell ever matches
  `RegExp.source`. Adding 23 more rows of escaped regex would add 23 more copies
  of that trap for no gain.
- The §5b "Pin" column is a **snapshot read on 2026-07-26**, and is labelled as
  one. It is not an invariant until F1 lands; nothing currently fails if it goes
  stale.
- A new vendor prefix now costs: dated spec + HIGH chain + byte/flags pin + one
  positive and one negative fixture + a §5b row. Not the CRITICAL chain.

## 5. Follow-ups — none implemented here (record-only task)

- **F1 — completeness check.** Assert the shipped name set equals the recorded
  name set (§5a ten + §5b 23; 32 + 1 observer). Makes the lock enumerable by
  construction. This is the adopted slice of Option 3.
- **F2 — four unpinned lock rows.** `anthropic_key`, `openai_key`,
  `bearer_token`, `env_value` have neither a `.source` nor a `.flags` pin, and
  `jwt` has a prefix pin only. Under §3 these need pins before their next edit;
  better to add them cold than under a security fix.
- **F3 — `PREFIX_DETECTORS` is a hardcoded list.** Its comment in
  `redact-superlinear.test.ts` claims it "is every prefix detector in the table,
  not the three that existed when this test was written". Nothing checks that. A
  new prefix detector inserted before `jwt` and not added to the list passes the
  ordering test vacuously — the exact vacuous-assertion shape this package has
  shipped three times, and an unchecked prose claim besides.
- **F4 — 07-19 record drift.** That spec's twenty-eight vendor detectors are
  designed, not shipped. Either mark it partially-superseded or note per-row
  what landed, so it stops reading as a description of the table.
