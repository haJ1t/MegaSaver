---
"@megasaver/policy": minor
---

Make seven super-linear redaction patterns linear, and stop the firewall ledger
depending on those patterns' bounds for containment.

`redact()`, `redactWithFindings()` and `redactForLedger()` run over arbitrary
tool output under a 4 MB cap, and truncation happens *after* redaction, so the
cap never protected the regex engine. Growth per input doubling, before → after
(reproduce with `node scripts/redos-probe.mjs timing`):

| pattern | before | after |
|---|---|---|
| `aws_secret_key` | ×3.95, 9,711 ms/100 KB | ×2.10, 0.16 ms |
| `api_key_header` | ×3.62, 5,309 ms | ×1.98, 0.15 ms |
| `basic_auth_header` | ×4.32, 4,121 ms | ×1.68, 0.18 ms |
| `db_url` | ×3.99, 6,070 ms | ×1.03, 3.86 ms |
| `url_basic_auth` | ×3.98, 970 ms | ×1.99, 237 ms |
| `private_key_block` | ×4.11, 147 s at 4 MB | ×2.19, ~7 s at 4 MB |
| `email` | ×3.75, 4,962 ms | ×2.06, 14 ms |

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
32768 characters *between the markers, newlines counted* — which with real
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

Two over-redactions are accepted and disclosed: text quoting *both* markers (a
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
