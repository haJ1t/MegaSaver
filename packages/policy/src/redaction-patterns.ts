import { z } from "zod";
import { ibanValid, luhnValid, tcknValid } from "./pii-validators.js";

// epic §9d — LOCKED baseline. Validated at module load (boundary, §8).
// Application order matters: jwk_private_key and jwt MUST run before every
// prefix detector (their base64url bodies contain `sk-`/`ghp_`/`hvs.`, and a
// prefix hit inside one disables the whole detector); anthropic_key MUST run
// before openai_key because `sk-ant-` is a prefix of the `sk-` shape; db_url
// before generic schemes; private_key_block spans newlines. All compiled with
// the `g` flag so `count` reflects every occurrence.
const redactionPatternSchema = z.object({
  name: z.string(),
  pattern: z.instanceof(RegExp),
  replacement: z.string(),
  validate: z.custom<(match: string) => boolean>((v) => typeof v === "function").optional(),
});

export type RedactionPattern = z.infer<typeof redactionPatternSchema>;

const baseline: RedactionPattern[] = [
  {
    // MUST RUN FIRST, ahead of every prefix detector. base64url contains `-`
    // and `_`, so `sk-` and `ghp_` occur inside real key material; if
    // openai_key/github_token fires there first its replacement inserts `[`,
    // the `d` run can no longer reach its closing quote, this lookahead fails,
    // and the ENTIRE object survives — measured 63 per 100,000 RSA-2048 JWKs,
    // with 5 of 6 CRT parameters intact, which alone reconstruct the key.
    // Ordering here is load-bearing, not cosmetic.
    // NOT a strict superset, though — the reorder has a right-side cost that an
    // earlier §5a revision denied. This segment's `[A-Za-z0-9_-]+` is greedy and
    // unbounded, so it swallows a following base64url run including a later
    // detector's INDICATOR when the two are glued by zero or more
    // `[A-Za-z0-9_-]` chars: `<jwt>aws_secret_access_key = <40>` now reports only
    // `jwt` and leaves the secret in cleartext, and likewise for `bearer`, `SG.`
    // and `hvs.`. Any other separator terminates the run, which is why no real
    // tool-output shape triggers it. Both directions are pinned in
    // test/redact-jwt-order.test.ts — do not "fix" the loss by widening the
    // class; that reintroduces the quadratic `‡` exists to prevent.
    // JWK. The private material is `d` (asymmetric) or `k` (oct), but an ungated
    // `"d":"…"` is far too loose — measured, it matched 2 of 3 benign JSON
    // objects. So the object must also carry a `kty`, asserted by a LOOKAHEAD so
    // the two fields may appear in either order (JSON key order is not
    // guaranteed, and requiring kty first missed `{"d":…,"kty":…}`).
    // Every run is bounded and `[^{}]` cannot cross an object boundary, so the
    // scan stays inside one object; x1.89-2.01 per doubling on brace runs,
    // JSON noise, kty-without-d and d-without-kty.
    // Disclosed loss 1: a JWK carrying a nested object SIBLING of kty/d is not
    // matched at all and emits no finding, because `[^{}]` cannot cross into it
    // — e.g. multi-prime RSA (`"oth":[{...}]`) and `{"kty":…,"d":…,"ext":{…}}`.
    // RFC 7517 §4 permits arbitrary additional members, so this is a real shape.
    // Fixing it needs one-level brace nesting, which reintroduces a nested
    // quantifier on a hot path; not worth it for `oth[]`.
    // Disclosed loss 2: an object longer than 4096 characters is not matched at
    // all — an RSA-6144 JWK (4,684 chars) or a 3-certificate `x5c` chain
    // (5,540) leaks entirely. RSA-4096 (3,147) is covered.
    // Accepted over-redaction: the whole object is consumed, so `kid`, `alg` and
    // `use` are destroyed with the secret.
    name: "jwk_private_key",
    pattern:
      /\{(?=[^{}]{0,4096}"kty"\s*:\s*"(?:RSA|EC|OKP|oct)")(?=[^{}]{0,4096}"(?:d|k)"\s*:\s*"[A-Za-z0-9_-]{20,}")[^{}]{1,4096}\}/g,
    replacement: "[REDACTED JWK PRIVATE KEY]",
  },
  {
    // A base64-wrapped PEM is a whole private key one `base64 -d` away, and is
    // how kubectl/kubeconfig carry them — the armour markers never appear, so
    // private_key_block cannot see it. `LS0tLS1CRUdJTi` is the base64 of
    // `-----BEGIN `, which makes it detectable without a decode-and-rescan step.
    // `LS0tLS1CRUdJTiB` alone is NOT enough: it is the base64 of `-----BEGIN `,
    // which every armour shares, so it redacted base64-wrapped CERTIFICATEs and
    // PUBLIC KEYs too — measured, and a mutant truncating the prefix survived
    // the whole suite because no negative fixture covered it.
    // The label must therefore be spelled in base64. `-----BEGIN ` sits at
    // offset 0, so alignment is deterministic, but the label length shifts
    // `PRIVATE KEY` across the three base64 phases — hence the three
    // alignment-stable slices of `RIVATE KEY`. 12 of 12 correct across the six
    // private and six non-private armour forms.
    // Six slices, not three: `SECRET KEY` needs its own phase set. The sibling
    // `private_key_block` covers `(?:PRIVATE|SECRET)` because GnuPG's armour
    // table has three key-block headers, and the base64 form must agree with it
    // or the same leak reopens one detector over — it did.
    // The tail is LINE-STRUCTURED, and both halves of that are load-bearing.
    // A plain `\s` in the class let the greedy run cross the newline and eat the
    // next YAML key (`[REDACTED…]: kubernetes.io/tls`). Simply dropping `\s`
    // fixed that and broke every WRAPPED form: `openssl base64` (64 col) went to
    // 0 of 10 armour labels, and GNU `base64` (76 col) to 5 of 10 while still
    // REPORTING a finding — a green signal over ~97% of a key in cleartext.
    // The prior pattern did match wrapped base64; an earlier revision of this
    // comment asserted it did not, and that assertion was never checked.
    // The per-LINE floor of 16 separates the two: a real base64 line is 64 or 76
    // wide, while a following YAML key contributes at most a short alnum word
    // (`type` = 4). The first segment is unbounded, so the single-line form —
    // what `kubectl get secret -o yaml` actually emits — still matches whole.
    // Disclosed loss: a PEM base64'd at a non-zero offset inside a larger blob,
    // any label longer than 64 base64 chars before the noun, and line-wrapped
    // base64 (which neither this nor the previous form matched).
    name: "base64_pem_block",
    pattern:
      /LS0tLS1CRUdJTiB[A-Za-z0-9+/=]{0,64}(?:UklWQVRFIEtF|VkFURSBL|SVZBVEUgS0VZ|RUNSRVQgS0VZ|UkVUIEtF|Q1JFVCBL)[A-Za-z0-9+/=]{16,65536}(?:[\r\n]{1,2}[ \t]{0,8}[A-Za-z0-9+/=]{16,65536}){0,4096}/g,
    replacement: "[REDACTED BASE64 PRIVATE KEY]",
  },
  {
    // Ansible Vault: header line then hex body. One bounded class run with no
    // required literal after it — matches or fails in a single pass.
    name: "ansible_vault",
    pattern: /\$ANSIBLE_VAULT;[\d.]{1,8};[A-Z0-9]{3,32}(?:;[\w.-]{1,64})?[\s0-9a-f]{32,65536}/g,
    replacement: "[REDACTED ANSIBLE VAULT]",
  },
  {
    // MUST RUN AHEAD OF EVERY PREFIX DETECTOR, for the reason jwk_private_key
    // is first. JWT segments are base64url, so `sk-`, `ghp_`, `npm_`, `hvs.`
    // and `pypi-` occur inside real token bytes; when a prefix detector fires
    // there first its replacement inserts `[`, the segment run can no longer
    // reach its `.`, and the token survives with only the prefix span redacted.
    // Measured over 250,000 crypto-random JWTs: 367 losses in the old
    // order — 146.8 per 100,000, attribution `openai_key` 282, `jwt` 165, `sendgrid_key` 63, `github_token` 13, `npm_token` 7, `slack_token` 1, `gitlab_token` 1
    // — against 0 in this one. `vault_token` and `sendgrid_key` get there by
    // spanning a segment separator (`…hvs` + `.` + signature; `SG` + `.` +
    // payload + `.` + signature). This figure is a function of the CURRENT table,
    // so it moves whenever a prefix detector is added — an earlier revision of
    // this comment omitted `sendgrid_key` entirely and understated the rate as
    // 120 per 100,000. The committed test prints its own attribution line on
    // every run; trust that over this comment. Most of the losses
    // ALSO fired `jwt` on a surviving fragment, so a finding named `jwt` was
    // not proof the token had been redacted whole; the rest reported only a
    // benign-looking prefix hit over a token whose header, most of the payload
    // and whole signature were still in cleartext.
    // Consequence, deliberate: bearer_token ran first and claimed `Bearer
    // <jwt>` as `bearer_token`; that input now reports `jwt` and redacts to
    // `Bearer eyJ[REDACTED]`. bearer_token was NOT moved along with jwt —
    // that would relabel `Bearer sk-…`/`Bearer ghp_…` as well, a strictly
    // wider findings change for no coverage gain.
    // Branch 1 is a performance guard that also narrows what matches, so it is
    // not swappable for any equally fast guard. Without it, every `eyJ` inside
    // a dotless base64url run is a start position that greedily scans to
    // end-of-input before failing `\.` — O(n) starts x O(n) length, 8.4 s at
    // 313 KiB. Rejecting glued starts collapses each start to O(1), the whole
    // scan to O(n).
    // Branch 2 costs almost nothing (0.32 ms per 313 KiB) precisely because `%`
    // sits OUTSIDE the run class: it terminates the dotless run, so an admitted
    // start scans only its own token. That is what makes percent-escaped
    // carriers — URL query strings and fragments — cheap to recover while the
    // shapes below are not.
    // Accepted cost (spec 2026-07-20 §5, corrected 20b): a JWT preceded directly
    // by a RAW [A-Za-z0-9_-] no longer redacts, so `session-<jwt>` and
    // `id_token_<jwt>` stay in cleartext. Narrowing the class to [A-Za-z0-9]
    // recovers those two and reintroduces the full quadratic — see
    // test/redact-jwt.test.ts, which pins the percent recoveries too.
    // `Bearer<jwt>`, `ghs_<body>_<jwt>` and raw base64-run glue are lost the
    // same way, and no other detector covers those bytes.
    name: "jwt",
    pattern:
      /(?:(?<![A-Za-z0-9_-])|(?<=%[0-9A-Fa-f][0-9A-Fa-f]))eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replacement: "eyJ[REDACTED]",
  },
  {
    // Slack incoming webhooks and workflow/trigger URLs: the URL IS the
    // credential — anyone holding it can post as the app. `slack_token` cannot
    // reach these; they carry no `xox`/`xapp` prefix.
    //
    // MUST run ahead of every prefix detector, for the reason jwk_private_key
    // and jwt do. The body class holds `-` and `_`, so `sk-`/`xoxb-`/`npm_`
    // can occur inside a real token; a prefix hit there inserts `[`, which is
    // outside the class, the run stops at it, and the characters before the hit
    // leak. Partial rather than total, but a 24-char token that leaks a prefix
    // is a weakened token.
    //
    // The lookbehind is a fixed literal plus a bounded three-way alternation,
    // so it is not the unbounded-variable-length shape §3 of the superlinear
    // design removed. The lookahead's class is exactly the set of first
    // characters the body can match, so the guard is lossless. Nothing is
    // required after the run, so it cannot backtrack.
    //
    // Matching only the path AFTER `…/services/` keeps host and endpoint kind
    // in the output: report grouping needs a host. `/` is inside the class
    // because the credential is the whole `T…/B…/token` triple, not the last
    // segment.
    name: "slack_webhook_url",
    pattern:
      /(?=[A-Za-z0-9/_-])(?<=https?:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/)[A-Za-z0-9/_-]{16,}/gi,
    replacement: "[REDACTED]",
  },
  {
    // `github_pat_` is the FINE-GRAINED form and GitHub's recommended default;
    // `gh[pousr]_` cannot match it, because the character after `gh` is `i`.
    name: "github_token",
    pattern: /(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/g,
    replacement: "gh*_[REDACTED]",
  },
  {
    name: "anthropic_key",
    pattern: /sk-ant-[A-Za-z0-9\-_]{20,}/g,
    replacement: "sk-ant-[REDACTED]",
  },
  {
    name: "openai_key",
    pattern: /sk-[A-Za-z0-9]{20,}/g,
    replacement: "sk-[REDACTED]",
  },
  {
    name: "npm_token",
    pattern: /npm_[A-Za-z0-9]{30,}/g,
    replacement: "npm_[REDACTED]",
  },
  {
    name: "pypi_token",
    pattern: /pypi-[A-Za-z0-9_-]{16,}/g,
    replacement: "pypi-[REDACTED]",
  },
  {
    // HashiCorp Vault service (`hvs.`) and batch (`hvb.`) tokens.
    name: "vault_token",
    pattern: /hv[sb]\.[A-Za-z0-9_-]{20,}/g,
    replacement: "hv[REDACTED]",
  },
  {
    // Stripe SECRET and RESTRICTED keys. `pk_` is the PUBLISHABLE key and is
    // deliberately absent — it is not a secret and redacting it would be
    // evidence loss. `openai_key` cannot reach these: its prefix is `sk-`, and
    // Stripe uses `sk_`. Verified in both directions.
    name: "stripe_key",
    pattern: /(?:(?:sk|rk)_(?:live|test)|whsec)_[A-Za-z0-9]{16,}/g,
    replacement: "[REDACTED]",
  },
  {
    name: "slack_token",
    pattern: /(?:xox[baprse]|xapp)-[A-Za-z0-9-]{10,}/g,
    replacement: "[REDACTED]",
  },
  {
    name: "gitlab_token",
    pattern: /gl(?:pat|oas|rtr|rt|dt|cbt|ptt|ft|ffct|imt|soat|agent|wt)-[A-Za-z0-9_-]{20,}/g,
    replacement: "[REDACTED]",
  },
  {
    name: "sendgrid_key",
    pattern: /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
    replacement: "SG.[REDACTED]",
  },
  {
    name: "digitalocean_token",
    pattern: /do[opr]_v1_[a-f0-9]{64}/g,
    replacement: "[REDACTED]",
  },
  {
    // Twilio API Key SID: `SK` + exactly 32 lowercase hex, word-bounded. This is
    // the loosest shape in the table — there is no further structure to gate on,
    // so a bare 32-hex run prefixed by `SK` would also match. Measured over
    // 22,083 files / 189 MB of this repo plus node_modules: ZERO false
    // positives — and zero even at a relaxed {28,40} bound, while bare 32-hex
    // words occur 2,738 times, so the `SK` prefix plus `\b` is doing the work.
    // NAMED `_sid` deliberately: this matches the API Key SID, which is the HTTP
    // Basic USERNAME — an identifier, not the secret. It is kept for the same
    // reason `aws_access_key` is kept (an identifier that names the credential is
    // worth scrubbing), NOT because it is itself a credential. An earlier comment
    // claimed "the alternative is a live Twilio credential in cleartext"; that
    // was wrong about this shape.
    // Still uncovered, and these ARE the secrets: the Auth Token (32 hex, no
    // prefix) and the API Key Secret (32 alphanumeric, no prefix). Neither has a
    // distinguishing prefix, so neither is reachable by a regex at acceptable
    // false-positive cost. Disclosed rather than silently missing.
    name: "twilio_api_key_sid",
    pattern: /\bSK[0-9a-f]{32}\b/g,
    replacement: "[REDACTED]",
  },
  {
    // BIP32 extended PRIVATE keys only. The public `xpub`/`ypub`/`zpub` forms
    // are deliberately excluded — they are not secrets. WIF keys are not
    // covered: bare base58 has no distinguishing prefix and the false-positive
    // cost on ordinary text is too high.
    name: "bip32_xprv",
    pattern: /[xyz]prv[A-HJ-NP-Za-km-z1-9]{95,120}/g,
    replacement: "[REDACTED EXTENDED PRIVATE KEY]",
  },
  {
    // `ASIA` is the TEMPORARY (STS) prefix and is not optional: a complete
    // `aws sts assume-role` credential set produced `findings: []` without it.
    name: "aws_access_key",
    pattern: /A(?:KIA|SIA)[0-9A-Z]{16}/g,
    replacement: "AKIA[REDACTED]",
  },
  {
    // The leading lookahead is a pure performance guard and MUST stay in front
    // of the lookbehind. Its class is exactly the set of first characters the
    // body can match, so it is strictly implied and cannot drop a match; what
    // it does is reject a non-matching start position in O(1) before the
    // variable-length `\s*` lookbehind is walked. Without it every offset in a
    // whitespace run re-walks that lookbehind: 10,287 ms per 100 KB of spaces
    // versus 0.36 ms. Moving it after the lookbehind is semantically identical
    // and restores the full quadratic — test/redact-superlinear.test.ts pins
    // the position, because no output assertion can see that edit.
    // Caveat (spec 2026-07-25 §3a): the speedup relies on V8 evaluating
    // assertions left to right. That is an engine property, not a spec
    // guarantee; correctness does not depend on it, only speed.
    // The `i` flag is required, not cosmetic: `AWS_SECRET_ACCESS_KEY=<40>`
    // unquoted — a .env, `printenv`, a CI log — matched NOTHING without it,
    // because this lookbehind literal is lowercase (the ini form) and
    // env_value requires quotes. The body class already spans both cases, so
    // the flag widens only the indicator, which is the intent.
    name: "aws_secret_key",
    pattern: /(?=[A-Za-z0-9/+])(?<=aws_secret_access_key\s*=\s*)[A-Za-z0-9/+]{40}/gi,
    replacement: "[REDACTED]",
  },
  {
    // Runs AFTER jwt (see there): `Bearer <jwt>` is claimed by jwt now, so this
    // detector no longer sees that input. It still covers every opaque bearer
    // value, and it is deliberately left behind the prefix detectors so
    // `Bearer sk-…` keeps reporting openai_key rather than bearer_token.
    name: "bearer_token",
    pattern: /bearer\s+[A-Za-z0-9\-._~+/=]{20,}/gi,
    replacement: "Bearer [REDACTED]",
  },
  {
    // The body bound caps the forward scan each `-----BEGIN` start makes looking
    // for its `-----END`; unbounded, a run of BEGIN tokens with no END costs
    // 52,496 ms at the 4 MB capture cap. 32768 clears the largest private-key
    // body in practical existence (a Classic McEliece key, ~18.6 KB base64,
    // ~19.1 KB once wrapped) with ~1.7x margin.
    // On bound SIZE, the effect REVERSES with input size — do not read either
    // half of this without the other. `redos-probe.mjs bounds`, min-of-3, ms:
    //     bound        200KB     1MB     4MB   max base64 (64-col)
    //     none           114    2666   42394   unlimited
    //     16384          136     752    2988   16130  (below McEliece)
    //     32768          298    1457    6304   32262
    //     100000         708    4857   19896   98460
    // Below ~1 MB a larger bound is SLOWER than none: V8's counted lazy loop
    // costs ~2x per step and the bound exceeds the remaining input, so it prunes
    // nothing. At the 4 MB cap the ordering flips and the bound is what saves
    // you. Raising this bound is therefore NOT categorically unsafe; it trades
    // small-input constant for large-input asymptote. 16384 would be 2.1x faster
    // at the cap and is rejected because 16,130 base64 chars does not cover a
    // Classic McEliece key (18,828).
    // Disclosed loss: a PEM body over 32768 CHARACTERS BETWEEN THE MARKERS —
    // newlines count. Measured on 64-column wrapping: the last base64 length
    // that fits is 32,262 chars with LF (~23.6 KiB of raw key) and 31,772 with
    // CRLF (~23.3 KiB), not 32 KB.
    // The label is a sequence of ALPHANUMERIC GROUPS, not a character class, and
    // that structure is load-bearing rather than stylistic. A permissive class
    // is what a future editor will reach for; both forms were measured:
    //   [A-Z ]*             552 ms/400 KB  covers 10 of OpenSSL's 29 labels
    //   [A-Za-z0-9. -]*     QUADRATIC — 1,148 ms at 16 KB, x7.13 per doubling
    //   [A-Za-z0-9. -]{0,64} 2,187 ms/400 KB (4x), linear
    //   grouped (shipped)   ~600 ms/400 KB, linear, covers 32 of 32
    // The unbounded class is catastrophic because it covers EVERY character of
    // `-----BEGIN A PRIVATE KEY-----`, so the label run swallows the whole input
    // and backtracks for `PRIVATE KEY`. Requiring each `.`/`-` to sit BETWEEN
    // alphanumerics stops the label crossing a `-----` at all, which is why the
    // grouped form costs what the old narrow class did while covering far more.
    // It is a nested quantifier, so it was attacked directly: 7 shapes built to
    // trigger (X+)* backtracking (dash runs, `A `/`A-1 `/`A.9 ` chains, near-miss
    // `PRIVATE KEZ`, dense BEGIN+group runs) all measure x1.81-2.04 and sub-1.1 ms
    // at 400 KB. Each group parses deterministically — `-` and `.` are outside
    // `[A-Za-z0-9]`, so there is no ambiguous split for the engine to explore.
    //
    // The label run is `*` not `+`, ` BLOCK` is optional, and the noun is
    // `(?:PRIVATE|SECRET)`, because the original `[A-Z ]+PRIVATE KEY` could not
    // spell three real headers, each of which reached the agent and the
    // firewall ledger with `findings: []`:
    //   -----BEGIN PRIVATE KEY-----            PKCS#8, `openssl genpkey`
    //   -----BEGIN PGP PRIVATE KEY BLOCK-----  trailing ` BLOCK`
    //   -----BEGIN PGP SECRET KEY BLOCK-----   GnuPG's third armour header
    // and, with the old uppercase-and-space label class, 19 of the 32 concrete labels in
    // OpenSSL 3.6.2's own PEM table — the whole NIST post-quantum set
    // (ML-DSA-*, ML-KEM-*, 12 SLH-DSA-* variants), every modern curve
    // (ED25519, ED448, X25519, X448), SM2, RSA-PSS, and `X9.42 DH` (a dot).
    // The SLH-DSA labels end in a lowercase `f`/`s`, which is why the group
    // class is `[A-Za-z0-9]`: an all-uppercase label assumption is simply wrong.
    // No CLI path emits these labels today (`genpkey` writes unlabelled PKCS#8
    // and `-traditional` is unsupported for them), but they are in OpenSSL's
    // DECODER table, so any library caller using the traditional writer produces
    // files OpenSSL reads back as private keys.
    // GnuPG's own table has all three of PRIVATE/PUBLIC/SECRET KEY BLOCK
    // (`strings $(which gpg) | grep 'KEY BLOCK'`).
    //
    // Why permissive rather than an explicit label alternation: NOT
    // future-proofing — measured, `openssl genpkey` emits *unlabelled* PKCS#8
    // for ML-DSA and ML-KEM, so new algorithms arrive with no label and an
    // alternation with an empty branch would cover them equally. The reasons
    // are (a) error-cost asymmetry — a miss is a private key in cleartext,
    // while a false positive costs evidence on a span bracketed by BEGIN/END
    // key markers, which essentially no benign text has; and (b) an alternation
    // is a list, and every unlisted vendor label would need a §5a lock-table
    // amendment and a CRITICAL review chain. `[A-Z ]*` never does.
    //
    // Coverage of OpenSSL 3.6.2's own PEM table went from 7 of 32 concrete
    // `PRIVATE KEY` labels to 32 of 32 (the 33rd string is the `%s PRIVATE KEY`
    // printf template, correctly excluded). RFC 4716, PuTTY, age and JWK are not
    // PEM-armoured at all and have their own detectors above/below.
    //
    // BEGIN and END labels may DIFFER, and ` BLOCK` is independently optional on
    // each — both deliberate. Tying them with a backreference would stop
    // redacting concatenated, hand-edited and mislabelled exports, converting a
    // robustness case into the exact leak class above; the cost is that prose
    // pairing a bare BEGIN with a labelled END is consumed. Pinned in
    // test/redact-superlinear.test.ts, which is otherwise blind to it because
    // every PEM fixture is symmetric by construction.
    //
    // Accepted over-redaction: any text quoting BOTH markers now matches — a PEM
    // parse error, or prose describing the format. Requiring a newline after the
    // BEGIN marker would fix that and was rejected, because GCP service-account
    // JSON carries the key with literal `\n` ESCAPES, not real newlines.
    //
    // Accepted cost: PKCS#8 and PGP runs were previously non-matching and free;
    // each marker is now a real start position scanning to the bound. On an idle
    // box at the 4 MB cap, isolated, min-of-3: the pre-existing labelled seed
    // 5,760 -> 6,227 ms, PKCS#8 3.3 -> 6,976 ms, PGP 3.6 -> 4,818 ms. The number
    // that matters for availability is the CEILING, since an attacker picks the
    // best seed: 5,760 -> 6,976 ms, +21%. All growth x1.97-2.10, i.e. linear.
    name: "private_key_block",
    pattern:
      /-----BEGIN (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*(?:PRIVATE|SECRET) KEY(?: BLOCK)?-----[\s\S]{1,32768}?-----END (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*(?:PRIVATE|SECRET) KEY(?: BLOCK)?-----/g,
    replacement: "[REDACTED PRIVATE KEY]",
  },
  // --- Private keys that are NOT PEM-armoured. private_key_block cannot reach
  // these however its label is widened, because none of them uses `-----`.
  // Each has a distinctive anchor and none overlaps the others (verified).
  {
    // RFC 4716: FOUR dashes and spaces inside the delimiters. The same armour
    // carries PUBLIC keys — `ssh-keygen -e -m RFC4716` emits exactly that — so
    // the `PRIVATE KEY` literal is the whole separation and must not be relaxed.
    // Body bound and label structure mirror private_key_block for the same
    // reasons; measured x2.09 per doubling on a run of BEGIN markers with no END.
    name: "ssh2_private_key_block",
    pattern:
      /---- BEGIN (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*PRIVATE KEY ----[\s\S]{1,32768}?---- END (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*PRIVATE KEY ----/g,
    replacement: "[REDACTED PRIVATE KEY]",
  },
  {
    // PuTTY .ppk has no armour at all. The file always ends with a `Private-MAC:`
    // line, so the lazy body scans to that literal rather than to a marker;
    // bounded for the same reason as every other lazy body here. Redacting the
    // whole file rather than just the private lines is deliberate — a .ppk is a
    // key file, and the public half carries no evidence worth preserving.
    // x2.09 per doubling on a run of headers with no Private-MAC.
    // The bound is 8192, NOT private_key_block's 32768: that value is justified
    // by a Classic McEliece key and has nothing to do with PuTTY, which supports
    // only RSA/DSA/ECDSA/Ed25519/Ed448. An RSA-4096 .ppk is well under 8 KB.
    // Accepted over-redaction, and it is larger than it looks: nothing requires
    // the span to BE a file. Any text naming the header and a later
    // `Private-MAC:` is consumed — a puttygen error log, a changelog entry, a
    // support ticket quoting both. Measured: a .ppk header, 120 lines of build
    // output and a trailing MAC collapse to one marker. Halving the bound from
    // 32768 cuts that collateral 4x; the residual is accepted, not absent.
    name: "putty_private_key",
    pattern: /PuTTY-User-Key-File-\d{1,2}:[\s\S]{1,8192}?Private-MAC:[ \t]*[0-9a-fA-F]{16,128}/g,
    replacement: "[REDACTED PUTTY PRIVATE KEY]",
  },
  {
    // age identity: a fixed prefix plus uppercase bech32, same shape as the
    // github_token / openai_key entries. The prefix is preserved so the reader
    // can still see WHAT was redacted. The public half (`age1…`) is not a secret
    // and must stay — the literal `AGE-SECRET-KEY-1` PREFIX is what excludes it,
    // not the uppercase class. (An earlier comment credited the class; measured,
    // a case-insensitive class still rejects the public half, so the class is
    // belt-and-braces. Both are pinned.)
    // Not covered: `AGE-PLUGIN-*-1…` identities, which are a different prefix
    // and mostly hardware pointers rather than key material.
    name: "age_secret_key",
    pattern: /AGE-SECRET-KEY-1[0-9A-Z]{50,120}/g,
    replacement: "AGE-SECRET-KEY-[REDACTED]",
  },
  {
    name: "env_value",
    pattern: /(?<=^[A-Z_]+=)["'].+?["']/gm,
    replacement: '"[REDACTED]"',
  },
  {
    // Both userinfo runs are bounded, and both bounds are load-bearing: with
    // only the user bounded the password scans to end-of-input from every start
    // on a blob carrying no `@` and no whitespace (x3.4 growth); with only the
    // password bounded `'postgres://a' + ':'.repeat(n)` stays quadratic (x2.2).
    // Together: 8,038 ms per 100 KB down to 1.15 ms, linear on all three seeds.
    // The password bound is 8192. Two earlier candidates were measured and are
    // BOTH too small: 256 (first proposal) leaves `postgres://user:<JWT>@host`
    // in cleartext, and 2048 leaves an AWS RDS IAM auth token (~2.2 KB) and a
    // JWE-shaped bearer token (~2.5 KB) in cleartext. A JWE matters because its
    // second segment is a wrapped CEK, not `eyJ`, so `jwt` cannot rescue it —
    // any test fixture for this bound must use an OPAQUE payload, never a JWS,
    // or `jwt` masks the result. Raising 2048 → 8192 here is free: 3.6 ms per
    // 200 KB either way, growth x1.00.
    // Trailing `\S+` stays unbounded: a measured non-driver, and bounding it
    // would truncate the host/path span the fixed replacement consumes.
    // Rejected alternative: `[^\s/:]+` for the user (a colon-free username
    // makes the split deterministic and needs no bound) — measured 13,333 LOSSES
    // in 200,000 seeded trials (scripts/redos-probe.mjs fuzz). The witness is
    // `postgres://:-_Z:pw@host` — TWO colons. (`postgres://:pw@host` is NOT a
    // loss: `[^\s/]+` needs >=1 character before the split colon, so the
    // baseline never redacted it either.)
    // Disclosed loss: userinfo user over 256, or password over 8192. The user
    // bound is partly mitigated — `url_basic_auth` below catches an over-long
    // username as a fallback (verified: a 300-char percent-encoded mongodb
    // username still redacts, as `mongodb://[REDACTED]@host` rather than
    // `[scheme]://[REDACTED]@[host]`).
    name: "db_url",
    pattern: /(?:postgres|postgresql|mysql|mongodb):\/\/[^\s/]{1,256}:[^\s@]{1,8192}@\S+/g,
    replacement: "[scheme]://[REDACTED]@[host]",
  },
  // --- Contextual secrets (no recognised prefix; identified by surrounding key).
  // Appended AFTER the prefix/structure patterns so those run first; these catch
  // the residue. Each uses a LOOKBEHIND for the indicator (param/flag/header/
  // scheme) so only the secret VALUE is matched and replaced with the marker —
  // the readable structure survives, and a redacted fetch URL still satisfies
  // overlayChunkSetSchema's z.string().url() guard. (A backreference in the PATTERN is available — only `$1`
  // in the REPLACEMENT is literal, since redact() replaces via a function — but
  // see private_key_block above for why tying two markers together is the wrong
  // trade for a redactor.)
  {
    // Credentials in URL userinfo on ANY scheme (db_url covers the db schemes
    // first; this catches http(s)/ftp/etc.). Username may be empty (password-only
    // / token-as-password) and the password may contain '/' — matching db_url's
    // strength. Scheme + host are kept, so the URL stays valid:
    // scheme://user:pass@host -> scheme://[REDACTED]@host. The password is LAZY
    // and may contain `@`, `/`, `:` (tools like curl accept unencoded ones); it
    // stops at the FIRST `@` that is followed by a real host (host chars, then a
    // `/?#:` delimiter or end-of-string) OR by end-of-string/whitespace (a
    // host-less userinfo, e.g. `redis://:pw@` at a truncated line boundary — no
    // host to connect to, but the credential is still a secret to scrub). That
    // anchor scrubs a whole `@`-bearing password (`user:p@ss@host` ->
    // `[REDACTED]@host`) without over-matching a later `@` in the path
    // (`.../@2x.png`). User stops at the first `:` (the user:password split).
    // The LAZY password run is bounded because it is the quadratic driver: it
    // expands to end-of-input at every `://`, costing 1,086 ms per 100 KB of
    // `'x://a:b/'` (67 ms bounded). The class cannot be narrowed instead — it
    // must keep `/` (base64 passwords contain it) and `@` (the whole reason
    // this pattern is lazy, per the note above). 8192 matches db_url's bound so
    // neither path has a cliff below the other; 256, 512 and 2048 were all
    // measured too small (2048 loses a ~2.5 KB JWE and a ~2.2 KB RDS IAM
    // token). Cost of 2048 -> 8192 is a 4x constant, 502 ms per 200 KB, still
    // linear at x2.08. As with db_url, fixture payloads must be OPAQUE, not a
    // JWS, or `jwt` redacts them first and the bound goes untested.
    // NOTE the seed: `'ht://a:b' + 'b'.repeat(n)`, published earlier as the
    // repro, is LINEAR and passes against the unfixed pattern.
    // Disclosed loss: userinfo password over 8192 characters.
    name: "url_basic_auth",
    pattern:
      /(?<=[a-z][a-z0-9+.-]*:\/\/)[^\s/?#:]*:[^\s?#]{1,8192}?(?=@(?:[^\s/?#@:]+(?:[/?#:]|$)|\s|$))/gi,
    replacement: "[REDACTED]",
  },
  {
    // Secret-valued query OR fragment params (#access_token=... is the OAuth
    // implicit-flow callback shape). Param name gated to clearly sensitive keys
    // to avoid redacting benign params (?page=, ?sort=); value stops at
    // &/#/quote/ws.
    name: "url_query_secret",
    pattern:
      /(?<=[?&#](?:access[_-]?token|api[_-]?key|client[_-]?secret|auth[_-]?token|session[_-]?(?:id|token)|id[_-]?token|token|secret|password|passwd|pwd|apikey|signature)=)[^&\s#"'<>]+/gi,
    replacement: "[REDACTED]",
  },
  {
    // Secret passed via a CLI flag with '=': --token=VALUE. Unambiguous, so the
    // unquoted value is matched directly. Bare --key is excluded (too ambiguous).
    name: "cli_secret_flag_eq",
    pattern:
      /(?<=--(?:password|passwd|pwd|token|api[_-]?key|apikey|secret|access[_-]?token|client[_-]?secret|auth[_-]?token)=)(?:"[^"]*"|'[^']*'|[^\s"']+)/gi,
    replacement: "[REDACTED]",
  },
  {
    // Secret passed via a space-separated CLI flag: --token "VALUE". ONLY a
    // QUOTED value is matched — an unquoted next token is indistinguishable from
    // prose / a following flag / a shell operator (&&, |, >), so matching it would
    // over-redact captured help text and error messages.
    name: "cli_secret_flag_spaced",
    pattern:
      /(?<=--(?:password|passwd|pwd|token|api[_-]?key|apikey|secret|access[_-]?token|client[_-]?secret|auth[_-]?token)[ \t])(?:"[^"]*"|'[^']*')/gi,
    replacement: "[REDACTED]",
  },
  {
    // Temporary but complete AWS credential, in the ini and env spellings.
    // NOT the STS JSON response — that spells the field `"SessionToken"` and is
    // covered by `json_secret_field` below. An earlier version of this comment
    // claimed STS coverage it did not have, and a full `aws sts assume-role`
    // credential set was leaking with `findings: []` as a result.
    name: "aws_session_token",
    pattern: /(?=[A-Za-z0-9/+=])(?<=aws_session_token\s*[:=]\s*)[A-Za-z0-9/+=]{40,}/gi,
    replacement: "[REDACTED]",
  },
  {
    // Secret-valued JSON fields: gcloud ADC refresh tokens, Azure client
    // secrets, docker registry `auth`/`identitytoken`, GCP `private_key_id`.
    // Gated on the FIELD NAME — a bare long string is not a secret. The `i` flag
    // is required: without it the list needs a hand-maintained entry per casing
    // convention, and it already missed `refreshToken` and `identityToken` while
    // carrying `clientSecret`. The value class excludes WHITESPACE so English
    // prose cannot qualify — `{"auth":"contact the administrator for access"}`
    // matched before that. One scheme word is allowed back in: `{"auth":"Basic
    // <b64>"}` is a real docker/registry shape, and the whitespace-free class
    // alone left it entirely uncovered — `basic_auth_header` gates on the
    // literal `authorization`, not `auth`, so nothing else reaches those bytes.
    // `SecretAccessKey`/`SessionToken` are here rather than in
    // `aws_session_token` because that is how STS spells them in JSON, and a
    // full `aws sts assume-role` credential set was leaking with `findings: []`.
    // Disclosed loss: a value containing a backslash escape or a space is
    // truncated at it.
    name: "json_secret_field",
    pattern:
      /(?=[^"\\\s])(?<="(?:refresh_?token|client_?secret|identity_?token|private_key_?id|secret_?access_?key|session_?token|auth)"\s*:\s*")(?:(?:Basic|Bearer|Digest|Token) )?[^"\\\s]{16,}/gi,
    replacement: "[REDACTED]",
  },
  {
    // Semicolon-delimited connection strings: ADO.NET, ODBC, `web.config`,
    // `appsettings.json`, the Azure portal. None of the existing detectors
    // reach them — `url_query_secret` needs `[?&#]`, `cli_secret_flag_eq` needs
    // `--`, and `env_value` needs line-start plus quotes. `AccountKey` is the
    // Azure Storage account secret, which is full control of the account.
    // The field name is the gate, and the value stops at the next `;` or
    // whitespace, so a following `Encrypt=True` survives. JDBC's query-param
    // and userinfo forms are already covered by url_query_secret and
    // url_basic_auth; only the semicolon form was missing.
    // The separator gate is `(?:^|;)`, NOT `[;\s]`, and there is no `m` flag.
    // Both were wrong together: with whitespace in the gate, `pwd` matched the
    // universal `PWD` environment variable — every `env`, `printenv`, `set -x`
    // trace and CI log carries one, so `PWD=/Users/x/proj` became
    // `PWD=[REDACTED]`. That is evidence destruction in exactly the stream this
    // redactor filters, against the stated non-goal of never stripping what the
    // model needs. And the `m` flag was DEAD: every position its `^` reached,
    // `[;\s]` had already reached, because `[;\s]` consumes the newline itself.
    // A mutant dropping `/m` survived all 262 behavioural tests and died only on
    // the flags pin — a comment asserting a property no test checked.
    // `^` without `m` still catches `Password=…` as the first field of a string,
    // which is the only case the whitespace alternative was there for.
    // `pwd` is DROPPED from the field list, not merely re-gated. Narrowing the
    // separator to `(?:^|;)` was not sufficient: `PWD=` at position 0 — the first
    // line of a `printenv` dump — still matched `^`. `Pwd=` is only an ADO.NET
    // alias for `Password=`, so the canonical spelling covers the real carrier,
    // and the collision with the universal shell variable is total.
    // Disclosed loss: a connection string that spells the field `Pwd=` and
    // nothing else on the line.
    // `SharedAccessSignature` is included because Azure SAS connection strings
    // are the other half of the same carrier and NOTHING else reached them:
    // `sharedaccesskey != sharedaccesssignature`, and `url_query_secret`'s list
    // carries `signature` but not the `sig=` that a SAS actually uses.
    name: "connection_string_secret",
    pattern:
      /(?=[^;\s])(?<=(?:^|;)\s{0,8}(?:password|accountkey|sharedaccesskey|sharedaccesssignature|userpassword)\s{0,8}=\s{0,8})(?:"(?:[^"]|""){8,8192}"|'(?:[^']|''){8,8192}'|[^;\s]{8,})/gi,
    replacement: "[REDACTED]",
  },
  {
    // .netrc. `password` alone is far too common in prose, so the lookbehind
    // requires a preceding `machine <host>` or `default` record. The `default`
    // branch is LINE-ANCHORED: a bare `\bdefault` is an ordinary English
    // adjective and matched inside OpenSSL's own shipped documentation ("the
    // default password prompting functions"). `default` is the netrc fallback
    // entry and holds credentials as often as `machine`;
    // `account` is a standard field that previously broke the gate.
    // The value is UNBOUNDED on purpose: a `{6,128}` ceiling left 72 characters
    // of a 200-character password in cleartext, and measured, unbounded is
    // same-or-faster (it matches in one pass instead of matching 128 and
    // re-anchoring). A ceiling that costs coverage and buys no speed is worse
    // than none.
    // Every run inside it is bounded, and the leading guard keeps the
    // variable-length lookbehind off non-matching start positions.
    name: "netrc_password",
    pattern:
      /(?=\S)(?<=(?:\bmachine\s{1,8}\S{1,253}|[\r\n][ \t]{0,8}default)\s{1,8}(?:(?:login|account)\s{1,8}\S{1,64}\s{1,8}){0,2}password\s{1,8})\S{6,}/g,
    replacement: "[REDACTED]",
  },
  {
    // Dedicated api-key / auth-token request headers (Bearer is handled above).
    // Leading lookahead: same O(1) start-position guard as aws_secret_key, and
    // the same rule — it must stay in front of the lookbehind. `\S` is exactly
    // the union of the three alternatives' first characters (`"`, `'`, and
    // `[^\s"']`), so it is strictly implied. 4,269 ms per 100 KB of spaces
    // without it, 0.26 ms with.
    name: "api_key_header",
    pattern:
      /(?=\S)(?<=(?:x-api-key|x-auth-token|x-access-token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s"']{8,})/gi,
    replacement: "[REDACTED]",
  },
  {
    // HTTP Basic credentials in an Authorization header (Bearer covered above).
    // Leading lookahead: same O(1) start-position guard, same must-stay-first
    // rule. This lookbehind has THREE variable-length runs, not two — the two
    // `\s*` AND the `\s+`. Bounding only the `\s*` pair was measured and is a
    // no-op (100 KB: 1,384 ms original, 1,349 ms bounded, still x4 growth); the
    // guard takes all three out at once, 4,506 ms per 100 KB down to 0.44 ms.
    name: "basic_auth_header",
    pattern: /(?=[A-Za-z0-9+/=])(?<=authorization\s*[:=]\s*basic\s+)[A-Za-z0-9+/=]{8,}/gi,
    replacement: "[REDACTED]",
  },
  {
    // 13–19 digits with optional single space/dash separators. The regex is
    // deliberately broad; the Luhn validate gate is what makes it precise.
    name: "credit_card",
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    replacement: "[REDACTED:credit_card]",
    validate: (match: string) => luhnValid(match.replace(/[ -]/g, "")),
  },
  {
    // `i` flag: IBANs appear lower/mixed-case in prose, and ibanValid upcases
    // before checking — without it a valid lowercase IBAN never reaches the
    // validator and leaks unredacted.
    name: "iban",
    pattern: /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\b/gi,
    replacement: "[REDACTED:iban]",
    validate: (match: string) => ibanValid(match),
  },
  {
    name: "tr_national_id",
    pattern: /\b[1-9][0-9]{10}\b/g,
    replacement: "[REDACTED:tr_national_id]",
    validate: (match: string) => tcknValid(match),
  },
];

export const REDACTION_PATTERNS: readonly RedactionPattern[] = z
  .array(redactionPatternSchema)
  .parse(baseline);

// Count-only observers: matches are COUNTED into RedactResult.observed but the
// text is never modified (spec: email redaction corrupts git/package metadata
// the agent legitimately needs).
const observedBaseline: RedactionPattern[] = [
  {
    // Local part bounded to the RFC 5321 limit; 18,441 ms per 200 KB of `X`
    // down to 25 ms. The DOMAIN is deliberately left unbounded: a domain bound
    // has a total-loss shape (`u@` + 300 non-dot chars + `.com` goes fully
    // unredacted, since the one start position cannot reach the dot), whereas
    // an over-long local part only makes the match START LATER — the `@domain`
    // is still consumed, so no ADDRESS survives intact. 50,000 seeded trials:
    // 23,334 output divergences, zero addresses lost, zero count changes
    // (scripts/redos-probe.mjs fuzz).
    // A symmetric left-boundary guard was rejected as lossy: on
    // `a@b.com.c@d.com` it matches only `a@b.com` (1) where this pattern
    // matches `a@b.com` and `.c@d.com` (2), so it DROPS the second address.
    // (A "14,274 divergences" figure was previously cited here and is withdrawn:
    // the committed harness reproduces 0 on its generator, which never emits
    // adjacent addresses. The witness above is the evidence, not a count.)
    // Not lossless on the LEDGER path, though — see the userinfo scrub in
    // redact.ts. Under the old unbounded local part this pattern incidentally
    // swallowed a whole base64url URL password plus `@host`, so it acted as an
    // accidental backstop for `redactForLedger` whenever `url_basic_auth`
    // missed. The bound removes that: the match now starts 64 chars before the
    // `@`, so L-64 characters of an over-long run persist. Nobody designed the
    // backstop, but it was load-bearing.
    name: "email",
    pattern: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replacement: "",
  },
];
export const OBSERVED_PATTERNS: readonly RedactionPattern[] = z
  .array(redactionPatternSchema)
  .parse(observedBaseline);
