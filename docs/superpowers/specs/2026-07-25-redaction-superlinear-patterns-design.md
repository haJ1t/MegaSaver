# Seven Super-Linear Redaction Patterns + Private-Key Header Coverage — Design

- **Date:** 2026-07-25
- **Status:** **REVISED after review.** Four independent reviewers
  (`security-reviewer`, `critic`, `code-reviewer`, `verifier`) ran against the
  first revision. Two security **blockers** and a set of false statements in the
  shipped comments were found and are fixed here; §11 is the review trail. Read
  §11 before trusting any figure quoted elsewhere from the earlier revision.
- **Risk:** **CRITICAL** overall (§12). Three tiers, highest governs:
  - **CRITICAL** — `aws_secret_key`, `db_url`, `private_key_block`: §5a
    lock-table entries. Chain: HIGH + `architect` + `security-reviewer` +
    `critic` + a §5a amendment **in the same commit**.
  - **HIGH** — `api_key_header`, `basic_auth_header`, `url_basic_auth`:
    post-lock additions. Chain: `code-reviewer` + `critic`.
  - **MEDIUM** — `email` (`OBSERVED_PATTERNS`).
  TDD and the equivalence corpus are identical for all seven.
- **Reproducing every number here:** `node scripts/redos-probe.mjs {timing |
  fuzz | bounds}`. Absolute milliseconds move 1.5x or more run to run on one box
  and several times across Node versions; **growth per doubling is the
  load-bearing figure** and is runtime-independent. The first revision of this
  spec quoted two different measurement runs in different sections and was
  internally inconsistent as a result; everything below is one run of that
  script on an idle box, Node 25.8.2 (the repo pins Node 22, which reads
  faster — the discrepancy runs in the safe direction for a ceiling).
- **Prior art:** `docs/superpowers/specs/2026-07-20-jwt-redos-fix-design.md`
  (§0, §5, §6) and `wiki/concepts/unbounded-run-redos.md`.

---

## 1. Problem

`redact()`, `redactWithFindings()` and `redactForLedger()` run over arbitrary
tool output. Seven patterns in `packages/policy/src/redaction-patterns.ts` are
super-linear in input length — six in `REDACTION_PATTERNS` plus the `email`
observer. The input cap is **4 MB** (`packages/daemon/src/handlers.ts:76,78` —
`MAX_BYTES_CEILING = 64_000` x `MAX_CAPTURE_FACTOR = 64`), and
`packages/output-filter/src/types.ts:182` calls `redactWithFindings(raw)` on the
**full** capture; the `.slice(0, 4000)` truncation happens *after* redaction. The
cap does not protect the regex engine.

### 1a. The defect shape

1. **Variable-length lookbehind re-evaluated at every start position** —
   `aws_secret_key`, `api_key_header`, `basic_auth_header`.
2. **Unbounded run followed by a required literal** — `db_url`,
   `url_basic_auth`, `private_key_block`, `email`.

### 1b. Corrections carried forward from earlier reports

- **`basic_auth_header` has THREE variable-length runs**: two `\s*` **and one
  `\s+`**. Bounding only the `\s*` pair is a measured no-op.
- **`email` is NOT count-only.** `redactForLedger()`
  (`packages/policy/src/redact.ts`) loops `OBSERVED_PATTERNS` and calls
  `out.replace(...)`. Live callers: `packages/context-gate/src/run.ts:105,160,290,333`
  and `run-command.ts:275,543`. A size gate on the observer loop is not safe.

### 1c. Measured baseline

`node scripts/redos-probe.mjs timing`:

| pattern | before 100 KB | before growth | after 100 KB | after growth |
|---|---|---|---|---|
| `aws_secret_key` | 9,711 ms | ×3.95 | **0.16 ms** | ×2.10 |
| `api_key_header` | 5,309 | ×3.62 | **0.15** | ×1.98 |
| `basic_auth_header` | 4,121 | ×4.32 | **0.18** | ×1.68 |
| `db_url` | 6,070 | ×3.99 | **3.86** | ×1.03 |
| `url_basic_auth` | 970 | ×3.98 | **237** | ×1.99 |
| `private_key_block` | 64 | ×4.11 | **128** | ×2.19 |
| `email` | 4,962 | ×3.75 | **14** | ×2.06 |

On a benign 200 KB build log every pattern costs ≤1.9 ms before and after — the
adversarial seeds are what change, not real input.

### 1d. The `url_basic_auth` repro that does not reproduce

An earlier published repro, `'ht://a:b' + 'b'.repeat(n)`, is **linear**; the
1,509 ms once attributed to it was `email`. The correct driver is
`'x://a:b/'.repeat(n)`. A test seeded with the wrong payload passes against the
unfixed pattern.

---

## 2. Goal, invariant, and residual

**Goal.** Every pattern linear (≤ ~2.2x per doubling) on its own adversarial
seed.

**Invariant.** No pattern may stop redacting a secret it redacts today except
where this document names the loss, measures it, and the reviewer tier signs it
off. Over-redaction is also a cost — Mega Saver never strips what the model
needs to decide. Measured: **0 over-redactions** in 364,000 per-pattern seeded
trials and 40,000 whole-pipeline trials.

**Residual, stated rather than left as "bounded".** Linear is not the same as
fast. At the 4 MB cap, post-fix, `private_key_block` costs **~7 s** on a run of
`-----BEGIN` tokens (idle box, min-of-3, isolated) and dominates the whole
pipeline; `url_basic_auth` costs
~4 s on a `://`-dense blob. That is a real availability lever on
attacker-influenceable tool output, reduced from ~147 s but not eliminated. The
honest remedies — a length gate ahead of redaction, or chunking — are **out of
scope here** and not implemented. Nothing in the suite pins an absolute cost at
the cap; the suite pins growth.

---

## 3. The fix

### 3a. Lookbehind patterns — first-character lookahead guard

| pattern | guard prepended |
|---|---|
| `aws_secret_key` | `(?=[A-Za-z0-9/+])` |
| `api_key_header` | `(?=\S)` |
| `basic_auth_header` | `(?=[A-Za-z0-9+/=])` |

**Equivalence is provable, not empirical.** Each guard's class is exactly the set
of first characters the body can match, so the assertion is *strictly implied*:

- `aws_secret_key` body `[A-Za-z0-9/+]{40}` → guard class ≡ body class.
- `basic_auth_header` body `[A-Za-z0-9+/=]{8,}` → guard class ≡ body class.
- `api_key_header` body `(?:"[^"]*"|'[^']*'|[^\s"']{8,})` → first chars
  `{"} ∪ {'} ∪ [^\s"']` = exactly `\S`.

An assertion implied by the rest of the pattern cannot remove a match; it only
prunes start positions that were going to fail. Independently verified by the
security reviewer three ways: a class-level proof over all 65,536 BMP code
units; an exhaustive first-character sweep (**986,880 cases, 263,756 producing
an old match, 0 divergences**); and a seeded structural fuzz (**900,000 trials,
658,796 with matches, 0 divergences**). Unicode `\s` members, lone surrogates,
and the legacy non-`u` case-folding carve-out (which keeps `ſ` and `K` out of
`[A-Za-z]`) were all checked and apply equally to guard and body.

**Why the guard and not a bound.** Both were measured; the guard is two to three
orders of magnitude faster than bounding *and* loses nothing, so it needs no
coverage statement. (The first revision quoted 481/510/387 ms at 50 KB for the
unguarded forms against a bound=64 column. Those figures contradicted §1c and
did not reproduce — the comparison stands, the numbers are withdrawn. Use
`scripts/redos-probe.mjs timing`.)

**Caveat, accepted and recorded.** The speedup relies on **V8 evaluating
assertions left to right**, so the cheap lookahead runs before the expensive
lookbehind. That is an engine property, not an ECMAScript guarantee.
Correctness is unaffected either way — the guard is semantically inert. The
mitigation is the §6 timing test: measured, the guard-after-lookbehind form
costs 6,283 / 5,287 / 4,837 ms at 100 KB against a 500 ms ceiling, so a
reordering engine trips it with ~200x margin.

### 3b. Non-lookbehind patterns — bounds

| pattern | change | disclosed loss |
|---|---|---|
| `db_url` | `[^\s/]{1,256}` user, `[^\s@]{1,8192}` password | user > 256 (mitigated, below) or password > 8192 |
| `url_basic_auth` | `[^\s?#]{1,8192}?` lazy password | password > 8192 |
| `private_key_block` | `[\s\S]{1,32768}?` body | body > 32768 chars **between the markers, newlines counted** |
| `email` | `[A-Za-z0-9._%+-]{1,64}` local part | no address lost; ledger residue, see §3c |

Prior art establishes the choice is per-pattern: for `jwt` a left-boundary
lookbehind was right and bounding wrong (real segments reach 16 KB); for the
output-filter signal regexes bounding was right and lookbehind lost matches.

#### `db_url` — two rejected bound values, both found by measurement

The audit's original candidate was `{1,256}` for the password. **256 leaves
`postgres://user:<JWT>@host` in cleartext.** Raised to 2048; the security review
then found **2048 is also too small**, and the reason it survived the first round
is a flaw in the test fixture, not in the reasoning:

- The first revision's fixture was `eyJhbGciOiJIUzI1NiJ9.${"a".repeat(700)}.sig`
  — a **JWS**. The `jwt` detector redacts that regardless of this bound, so the
  fixture proved only that the bound is ≥722. **Fixture payloads for these two
  bounds must be OPAQUE.**
- A **JWE** used as a URL password is opaque to `jwt`: five segments whose second
  is a wrapped CEK, not `eyJ`. Entra/Graph-style tokens run 1.2–2.5 KB.
  Measured at 2,530 chars: `findings: []`, full cleartext to the agent.
- An **AWS RDS IAM auth token** as the postgres password (a presigned URL used
  verbatim; `X-Amz-Security-Token` is documented as variable and ≥2048 bytes)
  is 2,198 chars at a 1,600-char session token — also cleartext at 2048, and
  redacted at a 600-char session token, so this is a live cliff.

Ships at **8192**, which for `db_url` is free (3.86 ms per 100 KB at either
value, growth ×1.03) and for `url_basic_auth` is a 4x constant that stays linear.

Which run needs the bound was measured, not assumed: bounding *either* alone
leaves a super-linear seed (user-only is ×3.4 on a no-`@`, no-whitespace blob;
password-only is ×2.2 on the colon seed). Trailing `\S+` stays **unbounded** — a
measured non-driver, and bounding it would truncate the host/path span the fixed
replacement consumes.

**Mitigation for the user bound**, added after review: `url_basic_auth` catches
an over-long `db_url` username as a fallback — a 300-char percent-encoded
mongodb username still redacts, as `mongodb://[REDACTED]@host` rather than
`[scheme]://[REDACTED]@[host]`. The loss is a change of replacement shape, not a
leak.

**Rejected alternative:** `[^\s/:]+` for the user (a colon-free username makes
the split deterministic and needs no bound). Measured **13,333 losses in 200,000
seeded trials**. The witness is `postgres://:-_Z:pw@host` — **two** colons. A
one-colon version, `postgres://:pw@host`, is **not** a loss: `[^\s/]+` needs ≥1
character before the split colon, so HEAD never redacted it either. The first
revision's source comment used the one-colon form and was therefore a
falsehood inviting exactly the edit it warned against.

#### `url_basic_auth`

The driver is the *lazy* `[^\s?#]+?`, which expands to end-of-input at every
`://`. The class cannot be narrowed instead: it must keep `/` (base64 passwords
contain it) and `@` (the reason the pattern is lazy at all). Bound matched to
`db_url`'s 8192 so neither path has a cliff below the other.

#### `private_key_block`

**The bound-size trade-off reverses with input size, and both halves must be
stated together.** The first revision stated only the first half, in the source
comment *and* in the §5a lock footnote — a future editor would have concluded
that raising a bound is categorically unsafe, the opposite of the truth at the
cap:

| bound | 200 KB | 1 MB | 4 MB | max base64 (64-col wrapped) |
|---|---|---|---|---|
| none | 114 ms | 2,666 | **42,394** | unlimited |
| 16384 | 136 | 752 | 2,988 | 16,130 — below McEliece |
| **32768 (shipped)** | 298 | 1,457 | **6,304** | 32,262 (~23.6 KiB raw) |
| 100000 | 708 | 4,857 | **19,896** | 98,460 |

Below ~1–2 MB a larger bound is slower than none, because V8's counted lazy loop
costs ~2x per step while the bound prunes nothing. At the 4 MB cap the ordering
flips: `{1,100000}` is **6x faster** than unbounded.

32768 clears a Classic McEliece private key (~18.6 KB base64, ~19.1 KB wrapped),
the largest in practical existence, with ~1.7x margin. `[A-Z ]+` is left
unbounded — a measured non-driver (<1 ms at 1 MB).

**The bound counts newlines.** Real 64-column PEM wrapping costs ~1 character in
65, so the effective ceiling is **32,262 base64 characters ≈ 23.6 KB of raw key
material**, not 32 KB. The first revision's test helper built single-line bodies,
which overstated capacity and hid this.

#### `private_key_block` — header coverage (second amendment, same date)

Separate from the bound, and **pre-existing in the locked baseline rather than
caused by this change**: `[A-Z ]+` required at least one character between
`BEGIN ` and `PRIVATE KEY`, so two real formats never matched at all.

| header | before | after |
|---|---|---|
| `-----BEGIN PRIVATE KEY-----` (PKCS#8) | **MISSED** | redacted |
| `-----BEGIN PGP PRIVATE KEY BLOCK-----` | **MISSED** | redacted |
| `-----BEGIN PGP SECRET KEY BLOCK-----` | **MISSED** | redacted |
| `RSA` / `EC` / `DSA` / `OPENSSH` / `ENCRYPTED` | redacted | redacted |

The third row was found by the `security-reviewer` pass on the *first* attempt at
this amendment, which widened only the label and the ` BLOCK` suffix. GnuPG's
armour table carries three key-block headers, not two — PRIVATE, PUBLIC and
SECRET (`strings $(which gpg) | grep 'KEY BLOCK'`). Same defect, one word over,
found by the same method. Hence `(?:PRIVATE|SECRET)`.

PKCS#8 is what `openssl genpkey` emits and what GCP service-account JSON keys and
Kubernetes TLS secrets carry — arguably the most common modern form. A 2,400-char
key passed `redactWithFindings` with `findings: []` and landed verbatim in the
firewall ledger. PGP failed because the trailing ` BLOCK` broke the `-----` anchor.

Fix: `[A-Z ]*` for the label and an optional `(?: BLOCK)?` on both markers.

**Accepted cost.** These shapes were previously *non-matching* and therefore
free; each marker is now a real start position scanning to the 32768 bound. Idle
box, 4 MB cap, isolated pattern, min-of-3:

| seed | before | after |
|---|---|---|
| labelled (pre-existing worst) | 5,760 ms | 6,227 ms |
| PKCS#8 (new) | 3.3 ms | **6,976 ms** |
| PGP (new) | 3.6 ms | 4,818 ms |

The availability-relevant figure is the **ceiling**, not the number of seeds: an
attacker picks the best one, and the labelled seed already sat at it. The ceiling
moves **5,760 → 6,976 ms, +21%**, and that delta is start-position density (the
PKCS#8 marker is 27 bytes against 29). All growth ×1.97–2.10, linear, pinned by a
dedicated growth assertion per shape.

An earlier revision framed this as "three seeds reach the residual instead of
one", which invites reading exposure as tripled. It is not. What genuinely rises
is the chance of *accidentally* hitting the residual on benign input carrying
PKCS#8 or PGP markers.

**Over-redaction: two accepted cases, disclosed.** Text quoting BOTH markers is
now consumed — a PEM parse error naming them, or prose describing the format.
Neither matched before, since `[A-Z ]+` demanded a label. The obvious mitigation,
requiring a newline after the BEGIN marker, was **rejected**: GCP service-account
JSON carries the key with literal `\n` *escapes* rather than real newlines, so it
would stop redacting those. Losing a diagnostic line is the cheaper error. Both
cases are pinned as accepted rather than left to surprise someone.

Everything else is unaffected: 19 non-private-key armours were checked old-vs-new
with identical match counts, including `PGP PUBLIC KEY BLOCK`, which differs from
the private form by one word.

**Which negatives are load-bearing** was measured against the mutant family, not
assumed: `PUBLIC KEY` and `PGP PUBLIC KEY BLOCK` do the work, the latter uniquely
catching a mutant that floats ` BLOCK` off the noun. `CERTIFICATE` and
`PGP MESSAGE` kill nothing and are documentation of intent. The all-lowercase row
constrains the label class not at all — the literal `BEGIN`/`END` are uppercase,
so even a `[\s\S]*?` label leaves it unmatched. An earlier revision claimed a
`[A-Z ]*KEY` mutant "fails three of those assertions"; it fails **two**, the
third failure being the §5a byte pin.

**Six mutants initially survived the whole suite**, each failing only that byte
pin — which fires on any character change and detects nothing behavioural:
dropping the body's lazy `?` (one match spanning two keys, `count` 2→1, text
between them destroyed); loosening only the **END** label (every fixture paired
matching labels, so the END marker was never consulted); label → `[A-Za-z ]*`;
` BLOCK` → `(?: [A-Z]+)?` or `\s?BLOCK`; and folding the space after `BEGIN` into
the class. All are now killed behaviourally.

**BEGIN and END labels may differ, and ` BLOCK` is independently optional on
each** — deliberate. A backreference tying them would stop redacting
concatenated, hand-edited and mislabelled exports, converting a robustness case
into the leak class this section exists to close. Every PEM fixture is symmetric
by construction, so that edit would otherwise pass the entire behavioural suite;
it is now pinned in both directions.

**Superseded by the label-grouping amendment below**, which took coverage of
OpenSSL's PEM table from 7 to 32 of 32 concrete labels — `RSA-PSS` among them.
RFC 4716, PuTTY, age and JWK are not PEM-armoured and have their own detectors
(§3e).

**Why permissive rather than an explicit label alternation** — and *not* for the
reason first given. Future-proofing is a wash: measured, `openssl genpkey` emits
*unlabelled* PKCS#8 for ML-DSA and ML-KEM, so new algorithms arrive with no label
and an alternation with an empty branch covers them equally. The real reasons are
error-cost asymmetry (a miss is a private key in cleartext; a false positive
costs evidence on a span bracketed by key markers, which essentially no benign
text has) and that an alternation is a list — every unlisted vendor label would
need a §5a amendment and a CRITICAL chain.

Fuzz (`scripts/redos-probe.mjs fuzz`) now separates gains from losses:
`private_key_block` shows **10,253 gained** (this fix) against 13,459 lost (the
§3b bound, seeded deliberately above 32768).

#### `private_key_block` — label grouping (third amendment, same date)

The uppercase-and-space label class covered **7 of the 32** labels ending in
`PRIVATE KEY` in OpenSSL 3.6.2's own PEM table (`strings libcrypto | grep
'PRIVATE KEY$'`), the authoritative list of what OpenSSL decodes as a private
key. Missing: the whole NIST post-quantum set (`ML-DSA-44/65/87`,
`ML-KEM-512/768/1024`, twelve `SLH-DSA-*`), every modern curve (`ED25519`,
`ED448`, `X25519`, `X448`), `SM2`, `RSA-PSS`, and `X9.42 DH` — a **dot**.

The `SLH-DSA` labels end in a lowercase `f`/`s`, so the group class is
`[A-Za-z0-9]`. An all-uppercase label assumption is simply wrong, and a fixture
asserting lowercase labels never match had to be withdrawn.

Reachability is **weaker than for PKCS#8/PGP and is stated as such**: no OpenSSL
CLI path emits these labels (`genpkey` writes unlabelled PKCS#8; `-traditional`
is unsupported for them). They live in the *decoder* table plus a
`%s PRIVATE KEY` template, so a library caller using the traditional writer
produces files OpenSSL reads back as private keys. Taken on error-cost
asymmetry, given the change is close to free.

**The grouped form is load-bearing, and the obvious simplification is the
dangerous one.** Labelled-BEGIN-run seed:

| label form | 400 KB | growth | covers |
|---|---|---|---|
| `[A-Z ]*` (previous) | 552 ms | ×1.93 | 7/32 |
| `[A-Za-z0-9. -]*` | **1,148 ms at 16 KB** | **×7.13** | 32/32 |
| `[A-Za-z0-9. -]{0,64}` | 2,187 ms | ×1.77 | 32/32 |
| **grouped (shipped)** | **~600 ms** | ×2.16 | **32/32** |

The unbounded class is catastrophic because it covers **every character** of
`-----BEGIN A PRIVATE KEY-----`: the label run swallows the whole input and
backtracks for `PRIVATE KEY`. Requiring each `.`/`-` to sit *between*
alphanumerics stops the label crossing a `-----` at all, which is how the
grouped form costs what the narrow class did while covering three times as many
labels.

It is a nested quantifier, so it was attacked rather than assumed: seven `(X+)*`
shapes (dash runs, `A `/`A-1 `/`A.9 ` chains, near-miss `PRIVATE KEZ`, dense
BEGIN+group runs) all measure ×1.81–2.04 and sub-1.1 ms at 400 KB. Each group
parses deterministically — `-` and `.` are outside `[A-Za-z0-9]`, so there is no
ambiguous split to explore.

Four fixtures pin the structure behaviourally: `A- `, `-A `, `A. `, `A--B `
labels must NOT match, and all four DO match either character-class form. They
kill both class mutants **without** the timing test, which matters — under the
unbounded mutant that test takes over ten minutes.

### 3e. Private keys that are not PEM-armoured — four new detectors

`private_key_block` can only ever reach `-----`-armoured material. Four real
carriers are not:

| detector | carrier | anchor |
|---|---|---|
| `ssh2_private_key_block` | RFC 4716 | `---- BEGIN … PRIVATE KEY ----` (**four** dashes, spaces inside) |
| `putty_private_key` | PuTTY `.ppk` | `PuTTY-User-Key-File-N:` … `Private-MAC:` |
| `age_secret_key` | age identity | `AGE-SECRET-KEY-1` + uppercase bech32 |
| `jwk_private_key` | JWK / JSON | a `{…}` carrying both `kty` and `d`/`k` |

All four measure linear on a run of their own opening anchor with no terminator
(×2.09, ×2.09, ×1.45, ×1.89–2.01) and none overlaps `private_key_block` or the
others.

Two design points worth keeping:

- **RFC 4716 armour carries public keys too** — `ssh-keygen -e -m RFC4716`
  emits exactly that shape — so the `PRIVATE KEY` literal is the entire
  separation and is pinned as such.
- **An ungated `"d":"…"` is far too loose**: measured, it matched 2 of 3 benign
  JSON objects. The detector therefore requires `kty` in the same object,
  asserted by a **lookahead** so the two fields may appear in either order —
  requiring `kty` first missed `{"d":…,"kty":…}`, and JSON key order is not
  guaranteed. `[^{}]` cannot cross an object boundary, so the scan stays inside
  one object. 9 of 9 coverage/false-positive cases correct, including `oct`
  symmetric JWKs and a public JWK that must not match.

`age` preserves its prefix (`AGE-SECRET-KEY-[REDACTED]`) so the reader can see
what was removed; the public half (`age1…`, lowercase) is untouched, which the
uppercase class is what guarantees.

**Still not covered:** PKCS#12 (binary, out of scope for a text redactor).

### 3f. Credential carriers that are not key files (round 3)

`private_key_block` and the §3e detectors cover key *files*. A coding agent reads
far more credentials than that. Nine detectors, each measured linear on a run of
its own opening anchor with no terminator (×1.43–2.23, all under 2 ms per
200 KB), zero over-redaction across 523 MiB of real corpora:

| detector | carrier |
|---|---|
| `aws_session_token` | `~/.aws/credentials`, env dumps (ini and env spellings) |
| `json_secret_field` | gcloud ADC refresh tokens, Azure client secrets, docker registry `auth`/`identitytoken`, GCP `private_key_id`, STS `SecretAccessKey`/`SessionToken` |
| `netrc_password` | `.netrc`, gated on a `machine <host>` or `default` record |
| `npm_token` / `pypi_token` / `vault_token` | `.npmrc`, `.pypirc`, HashiCorp Vault |
| `ansible_vault` | `$ANSIBLE_VAULT` blobs, formats 1.1 and 1.2 |
| `bip32_xprv` | BIP32 extended private keys |
| `base64_pem_block` | base64-wrapped PEM — `kubectl get secret -o yaml`, kubeconfig |

Plus the **`i` flag on `aws_secret_key`**: `AWS_SECRET_ACCESS_KEY=<40>` unquoted,
the most common form an agent sees, matched nothing (lowercase lookbehind
literal; `env_value` needs quotes).

**Three findings worth carrying, because each is a defect pattern rather than a
one-off:**

1. **A gate keyed on a name list ages badly, and it aged within one round.** The
   first `json_secret_field` list mixed casing conventions ad hoc — it carried
   `clientSecret` but missed `refreshToken` and `identityToken`, the most common
   OAuth field name in JS. Fixed with the `i` flag. The value class also had no
   shape gate, so `{"auth":"contact the administrator for access"}` redacted;
   it now excludes whitespace, so English prose cannot qualify.
2. **A bound that costs coverage and buys no speed is worse than none.**
   `netrc_password` shipped `{6,128}` and left **72 characters of a 200-character
   password in cleartext**. Measured, unbounded is same-or-faster — it matches in
   one pass instead of matching 128 and re-anchoring. The ceiling was removed.
   Every other bound in this change was justified by a measurement; this one was
   copied from a sibling.
3. **`base64_pem_block` had to be built twice.** Keying on `LS0tLS1CRUdJTiB` —
   the base64 of `-----BEGIN `, which every armour shares — redacted
   base64-wrapped CERTIFICATEs and PUBLIC KEYs. The label must be spelled in
   base64, across the three phase alignments, and across **both** nouns: the
   first correct version covered only `PRIVATE` and reopened the
   `PGP SECRET KEY BLOCK` leak the §5a amendment had just closed in the PEM
   sibling. Two detectors that describe the same armour must be changed together.

**Disclosed:** `base64_pem_block` does not match line-wrapped base64 (neither did
any earlier form), a PEM base64'd at a non-zero offset, or a label over 64 base64
characters. `bip32_xprv` covers extended private keys only; WIF is **declined,
not unreachable** — it has both a prefix (`5`/`K`/`L`) and a fixed length, but the
false-positive cost on a 51-character base58 run is too high, and the `validate`
hook this table already provides (used by `credit_card`, `iban`,
`tr_national_id`) would be the right tool if it is ever revisited.

**Filed separately:** `jwt` has the same ordering exposure that `jwk_private_key`
was reordered to fix — measured 35 losses per 100,000 through the full pipeline,
mostly from `openai_key` firing inside base64url segments. The fix changes which
name appears in `findings[]` for `Bearer <jwt>`, which is public surface, so it
does not belong bolted onto this change. Also filed: ODBC/ADO semicolon
connection strings, and vendor prefixes (Stripe, Slack, GitLab, SendGrid,
Twilio, DigitalOcean).

#### `email` — local part only

Bounding the local part to the RFC 5321 limit removes the quadratic (4,962 →
14 ms at 100 KB). The **domain is deliberately unbounded**: a domain bound has a
total-loss shape (`'u@' + 'b'*300 + '.com'` goes fully unredacted, because the
single start position cannot reach the dot), which the local-part bound does not.

Seeded fuzz, `node scripts/redos-probe.mjs fuzz`, 50,000 trials, 49,997
matching: **23,334 output divergences, 0 addresses lost, 0 count changes.** When
the local part exceeds 64 the match simply **starts later** —
`'a'*100 + '@example.com'` redacts as `'a'*36 + <replacement>` — so the
`@domain` is always consumed.

A symmetric left-boundary guard was also rejected as lossy. **Direction
corrected:** on `a@b.com.c@d.com` the guard matches only `a@b.com` (1) where the
shipped pattern matches `a@b.com` and `.c@d.com` (2) — the guard **drops** the
second address. The first revision stated this backwards. The "14,274 fuzz
divergences" figure previously cited for it is **withdrawn**: the committed
harness reproduces 0 divergences on this generator, because the generator never
emits adjacent addresses. The named witness above is the evidence; the count was
not reproducible and should not have been quoted.

### 3c. Ledger containment — added after review

Bounding `email`'s local part had a consequence nobody designed for. Under the
old unbounded local part, `[A-Za-z0-9._%+-]+@…` swallowed an entire base64url URL
password plus `@host`, so whenever `url_basic_auth` missed an over-long password,
`redactForLedger` still came out clean. **`email` was an accidental backstop, and
it was load-bearing.** With `{1,64}` the match starts 64 characters before the
`@` and everything earlier survives:

| URL password length | old ledger | first-revision ledger | password chars persisted |
|---|---|---|---|
| 2000 | `[REDACTED]` | `[REDACTED]` | 0 |
| 2049 | `[REDACTED]` | 2,021 chars | **1,985 (96.9%)** |
| 8000 | `[REDACTED]` | 7,972 chars | 7,936 (99.2%) |

The sink is real: `packages/context-gate/src/run-command.ts:275,543` pass
`${command} ${args}` — exactly where a userinfo URL lives — into
`redactForLedger`; `packages/context-gate/src/firewall-ledger.ts:13` types
`sourcePath` as `z.string().optional()` with **no length cap** and appends it to
`<storeRoot>/firewall/events.jsonl`, whose own header says "value-free by
construction (F-FW-1)"; `packages/pro-analytics/src/firewall-report.ts:52,62`
then uses it as a grouping key.

**Fix: two ledger-only passes in `redactForLedger`, ordered after the agent-path
detectors and before the `email` observer.** The ledger has no
evidence-preservation requirement — that is scoped to the agent-visible path —
so over-scrubbing a label costs nothing.

1. `LEDGER_USERINFO = /(?<=:\/\/)[^\s]{0,8192}@/g` → `[REDACTED]@`. Greedy over
   non-whitespace, so it reaches the **last** `@` and an `@`-bearing password
   (`user:p@ss@host`) is scrubbed whole while the host survives for grouping.
2. `LEDGER_LONG_TOKEN = /[^\s]{2048,}/g` → `[REDACTED:long-token]`. **A bound
   always leaves a cliff** — a 9,000-character password slips past 8192 — so this
   is the cliff-free floor beneath it. It has no required literal after the run,
   so it cannot backtrack: one pass, linear, no bound needed.

Measured after the fix: **0 password characters persisted at every length from
100 to 40,000.** Ordinary paths are untouched; both passes are linear.

---

## 4. Rejected: the table-wide structural guard

Proposed and **tested**: it would not have caught these instances — 5 of 6 are
module-level consts outside both tables, and against a pattern-agnostic 46-shape
corpus it misses `jwt` entirely (0.1 ms) because the corpus never manufactures a
start position.

That failure reproduced here. The first differential fuzz written for this spec
used random strings and reported `matched=0` for **six of seven** patterns —
random text never manufactures `aws_secret_access_key=`, `postgres://`, or
`-----BEGIN … PRIVATE KEY-----`. It reported 0 divergences, which meant nothing.
Reseeded so every input carries a real anchor, it matched 23,000–50,000 of 50,000
and immediately found that the proposed `db_url` bound loses a
JWT-as-password. Every row `scripts/redos-probe.mjs fuzz` prints carries its
match count for this reason.

A future table-wide guard must be a **growth-ratio** test (n vs 2n, fail above
~2.5x) with per-pattern seeded shapes. Not in scope here.

---

## 5. Consumers and the lock record

No signature changes. `redact`, `redactWithFindings`, `redactForLedger`,
`RedactResult` and every finding name are untouched. `redactForLedger` gains
strictly more scrubbing (§3c). No consumer needs an edit.

**The lock record changes.** `aws_secret_key`, `db_url` and `private_key_block`
are §5a rows in `docs/superpowers/specs/2026-05-10-bb3-policy-design.md`, which
records pattern bytes verbatim. The amendment ships in the same commit and all
three rows are pinned byte-for-byte against `RegExp.source` in the test file, so
drift fails CI. Note the markdown-escaping trap the `jwt` row already documents:
the table escapes `|` and renders `/` plainly, so neither cell matches `.source`
— the footnote carries the exact bytes.

Release: **minor**, not patch — `db_url`, `url_basic_auth` and
`private_key_block` lose coverage above their bounds.

---

## 6. Testing

TDD; every assertion shown red before the fix. Single file,
`packages/policy/test/redact-superlinear.test.ts` (the plan called for two; the
corpus was folded into one).

### 6.1 Structural gates

- The three guarded patterns: `pattern.source.startsWith(<exact guard>)`. This
  is what catches an edit that moves the guard *after* the lookbehind —
  byte-identical output, full quadratic restored, invisible to every output
  assertion. Verified by mutation: 41 of 43 assertions stayed green.
- `url_basic_auth` and `email`: the source contains the exact bound token.
  `db_url` and `private_key_block` need no separate gate — the byte-exact §5a
  pins subsume one.
- `pattern.flags` for all seven; nothing else in the repo pins flags and `count`
  derives from a global replace.

### 6.2 Equivalence corpus

Pattern-level, one detector in isolation — deliberate, per the `jwt` §6
precedent: through the real pipeline an earlier detector often consumes the token
first (`bearer_token` eats a JWT before `jwt` sees it), so a pipeline assertion
would test ordering rather than the pattern.

Positives, each named because it is a shape a bound could plausibly break:
opaque 2.5 KB tokens as `db_url`/`url_basic_auth` passwords (**not** a JWS —
§3b); exactly-8192 passwords; 64-column-wrapped PEM bodies at RSA-4096,
RSA-16384, McEliece and 32,262; every PEM label; `aws_secret_access_key =\n  `;
`x-api-key : v` and `Authorization : Basic dXNlcjpw` (**whitespace before the
separator** — see §6.5); `svn+ssh://` and `s3://`; `'a'*100 + '@example.com'`.

Negatives pinning the disclosed losses, each commented with a pointer to §3b: a
2,049-… now 8,193-char db and URL password, and a 32,263-char PEM body. Plus two
`KNOWN GAP` assertions for the pre-existing PKCS#8/PGP miss (§10).

The first revision claimed straddle values 39/40/41, 63/64/65, 255/256/257 and
32767/32768/32769. Shipped are the boundaries that actually matter for the
shipped bounds — 64/100, 8192/8193, 32262/32263. The earlier list was aspirational
and is corrected rather than left contradicting the tests.

### 6.3 Timing — two instruments, split by measured separation

Not a growth ratio for every pattern, as the first revision claimed. **Neither
instrument alone is safe:**

- **Ceiling (500 ms at 100 KB)** for `aws_secret_key`, `api_key_header`,
  `basic_auth_header`, `db_url`, `email` — fixed and broken differ by ≥1000x.
- **Growth ratio (<3.0)** for `url_basic_auth` and `private_key_block`, where
  they do not. A ceiling would be actively wrong for `private_key_block`: fixed
  costs *more* than broken below ~256 KB, so a ceiling would flag the fix.
- A **ratio-only** suite is unsafe too: a broken `aws_secret_key` flattens toward
  ×1.4 once it is slow enough to hit thermal limits.

Threshold 3.0, not 2.5: fixed measures 1.68–2.43x (the highest being
`url_basic_auth` under load — **it**, not `private_key_block`, is the thin
margin), broken 3.6–7.5x. `{ retry: 3 }` per the `jwt` §6.2a precedent and it is
load-bearing here, not decoration. Ratio rungs are 64/128 KB and 128/256 KB —
broken is super-linear at every rung, so small rungs discriminate as well and
cost a quarter of the wall clock. A ratio below a 5 ms floor asserts cheapness
instead, because a **lower** bound on runtime would fail when the code gets
faster.

One pipeline-level growth assertion covers `redactWithFindings` end to end.

### 6.4 Non-vacuity

Every corpus asserts a minimum match count before asserting anything about what
it produced. See §4 for why.

### 6.5 What the suite failed to fence, and now does

Mutation testing found **32 of 32 mutants against `redaction-patterns.ts`
killed** — versus 4 of 5 *surviving* on the prior `jwt` fix. But four survivors
were found one layer up or on the un-pinned patterns, all now killed:

| mutant | why it survived | killed by |
|---|---|---|
| 200 KB size gate in `redactWithFindings` | **no test called `redact*()` at all** | public-surface tests |
| `api_key_header` drop `\s*` before `[:=]` | no fixture had whitespace before the separator | `x-api-key : v` |
| `url_basic_auth` scheme → `[a-z]+` | no fixture used a `+`/`.`/digit scheme | `svn+ssh://`, `s3://` |
| `basic_auth_header` `{8,}` → `{16,}` | no 8–15-char credential fixture | `Basic dXNlcjpw` |

The first is the serious one: the whole of `redact.ts` was unfenced. A size gate
returning early passed all 259 tests, sending every secret in a capture over
200 KB to the agent in cleartext — and `wiki/concepts/unbounded-run-redos.md`
records that exact idea as previously floated. §1b argued it away in prose with
no test behind the argument. Four public-surface tests now cover
`redactWithFindings` (including a 300 KB input with the secret last) and
`redactForLedger`.

### 6.6 Existing suites unmodified

`redact.test.ts`, `redact-jwt.test.ts`, `redact-pii.test.ts`,
`redact-unstructured.test.ts`, `redact.property.test.ts` pass untouched.

---

## 7. Evidence

- Red: 17 of 43 assertions failing (775 s). Green: **68 of 68 in 5.0 s.**
- `@megasaver/policy`: **281 tests**, no type errors. `pnpm verify` green.
- Mutation: 29/29 on the pattern table; the 4 survivors above now killed, each
  producing exactly one failure.
- Blockers closed and re-measured: a 2,530-char JWE as a URL password is
  redacted in both the agent output and the ledger; ledger retention is 0
  characters at every password length 100–40,000.
- `node scripts/redos-probe.mjs {timing,fuzz,bounds}` regenerates every figure.

---

## 8. Process

- Worktree `claude/hungry-yonath-a2a359`. Changeset **minor**.
- **Do not commit while an in-place mutation harness is running** — it leaves a
  mutant in the tree if interrupted. One review observed exactly that: the tree
  changed under it mid-measurement. Check `git diff` immediately before commit.

---

## 9. Not done

- `architect` and `tracer` passes were not run. Judgment call: the design choice
  was user-specified and settled by measurement rather than argument, and the
  causal chain was measured per-pattern rather than inferred. Both remain
  formally outstanding for the CRITICAL chain.
- TDD-first ordering is **unverifiable from the repo** — everything is in one
  uncommitted working-tree state, so there is no red-then-green commit record.
- The residual cost at the 4 MB cap (§2) is not pinned by any test.

## 10. Filed separately

`private_key_block` never matches unlabelled **PKCS#8**
(`-----BEGIN PRIVATE KEY-----`, what `openssl genpkey` emits and what GCP
service-account keys and Kubernetes TLS secrets carry) because `[A-Z ]+`
requires ≥1 character, nor **PGP** private key blocks (the trailing ` BLOCK`
breaks the `-----` anchor). Pre-existing at HEAD, not a regression here. The
first revision's tests defaulted every PEM fixture to `label = "RSA "`, which is
what concealed it; the label is now parameterised and the gap is asserted as a
`KNOWN GAP`.

## 11. Review trail

Four reviewers, none the author. Verdicts: `security-reviewer`
APPROVE_WITH_FIXES (2 blockers), `critic` NEEDS WORK (6 confirmed defects),
`code-reviewer` approve-with-changes (5 must-fix), `verifier` not-sufficient-to-
merge (3 stated figures wrong, DoD item 5 unmet).

Fixed here: both blockers (§3b password bounds, §3c ledger containment); the
unfenced `redact.ts` and three mutant survivors (§6.5); the reversed
`private_key_block` bound-size claim (§3b) and the non-reproducing
`postgres://:pw@host` witness (§3b); the inverted `email` guard direction and the
withdrawn 14,274 figure (§3b); `email` loss restated from "none" (§3c); the PEM
newline accounting (§3b); the §5a byte-exactness and markdown escaping (§5); the
contradictory measurement runs, now one committed harness (§1c); spec-vs-shipped
drift in §6.2/§6.3; "six" → "seven" throughout; and the stale evidence counts in
§7 (43 tests → 68, 5.8 s → 5.0 s measured fresh).

Two reviewers independently found the unfenced `redact.ts`, which is the
strongest signal in the review.
