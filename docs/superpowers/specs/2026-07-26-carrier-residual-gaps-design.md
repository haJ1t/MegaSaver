# Close the three disclosed carrier gaps left by the 2026-07-26 vendor rows

- Status: user-approved design
- Risk: **CRITICAL** — adds a name to `REDACTION_PATTERNS`, which is public
  surface (`findings[].name` is a grouping key in
  `packages/pro-analytics/src/firewall-report.ts`), and edits two shipped
  detector bodies.
- Supersedes nothing. Amends
  [[docs/superpowers/specs/2026-05-10-bb3-policy-design]] §5b.
- Related: [[docs/superpowers/specs/2026-07-26-redaction-lock-scope-adr]]
  (tier is by change shape, not by table).

## 1. Problem

§5b's "Disclosed coverage gaps in the 2026-07-26 vendor rows" table records
three gaps as *known and unclosed*. They were disclosed rather than hidden, so
this is not a correction — it is finishing the row. Measured against the
shipped table at `769d7efd`, each is a **no-redaction**, `fired: (none)`:

| carrier | measured |
|---|---|
| `https://hooks.slack.com/services/T…/B…/<24>` | `(none)` |
| `https://hooks.slack.com/workflows/T…/A…/…/<24>` | `(none)` |
| `glrtr- glft- glimt- glagent- glwt- glsoat- glffct-` | `(none)` ×7 |
| `…;` **space** `Password=<23>` | `(none)` |
| `…;Password` **space** `=` **space** `<23>` | `(none)` |
| `…;` **newline** `Password=<23>` | `(none)` |
| `…;Password="pw;with;semis;ZZZZ"` | `(none)` |
| `…;Password='pw;with;semis;ZZZZ'` | `(none)` |

Twelve leaks. Two controls in the same harness (`glpat-`, `;Password=`) redact,
so the measurement is not vacuous.

The quoted case fires *nothing at all* rather than redacting a prefix: the body
`[^;\s]{8,}` sees `"pw` — three characters — before the first `;`, which is
under the 8-character floor, so there is no match to shorten. The whole
password leaks, including the segment before the first delimiter.

## 2. Why these three and not the other four

The remaining §5b gaps stay open, deliberately:

- `stripe_key` / `pk_` — the publishable key is not a secret. Redacting it is
  evidence loss.
- `digitalocean_token` — `do[opr]_v1_` already covers PAT, OAuth and refresh.
- `twilio_api_key_sid` — the Auth Token and API Key Secret have no
  distinguishing prefix. Unreachable by regex at acceptable false-positive cost.
- `connection_string_secret` / `Pwd=` — collides with the universal `PWD` shell
  variable, and narrowing the separator does not help because `PWD=` can sit at
  position 0. Already settled; do not reopen.

## 3. Design

### 3a. `slack_webhook_url` — new detector

```
(?=[A-Za-z0-9/_-])(?<=[Hh][Tt][Tt][Pp][Ss]?:\/\/[Hh][Oo][Oo][Kk][Ss]\.[Ss][Ll][Aa][Cc][Kk]\.[Cc][Oo][Mm]\/(?:services|workflows|triggers)\/)[A-Za-z0-9\/_-]{16,}
```

Replacement `[REDACTED]`, flags `g`. Explicit case-pairs cover the URL scheme
and DNS host, which are case-insensitive, without applying that folding to the
case-sensitive Slack endpoint path. This prevents a credential from escaping
when a logger renders `HTTPS://HOOKS.SLACK.COM` in uppercase.

- **Anchored, not prefix-shaped.** The lookbehind is a fixed literal plus a
  three-way bounded alternation, so it is not the unbounded-variable-length
  lookbehind class that §3 of the superlinear design fixed.
- **The lookahead guard is lossless.** Its class is exactly the set of first
  characters the body can match (`[A-Za-z0-9/_-]`), so it can only reject
  positions the body would reject. Same construction, same proof, as
  `aws_secret_key`.
- **Host and endpoint kind survive.** Matching only the path *after*
  `…/services/` keeps `https://hooks.slack.com/services/` in the output, so
  report grouping still has a host — the same reason `url_basic_auth` keeps its
  host and `sendgrid_key` keeps `SG.`.
- **`/` is in the body class on purpose.** For `services` the credential is the
  whole `T…/B…/token` triple, not the last segment; for `workflows` it is a
  four-segment path. A class without `/` would redact only the first segment.
- **`https?`, not `https`.** Slack serves only TLS, but a logged plaintext URL
  is still a live credential.
- **No terminator after the run**, so the `{16,}` run cannot backtrack: linear
  by construction, no bound needed.

**Ordering: immediately after `jwt`, ahead of every prefix detector.** The body
class contains `-` and `_`, so a prefix detector (`openai_key` `sk-`,
`slack_token` `xoxb-`, `npm_token` `npm_`) can fire *inside* the token. Its
replacement inserts `[`, which is outside the body class, so the surviving
`slack_webhook_url` match stops there and the characters before the prefix hit
leak. Partial, not total, but a 24-character token that leaks a prefix is
weakened. Pinned by extending the existing ordering test, not a bespoke one.

### 3b. `gitlab_token` — complete the prefix set

```
gl(?:pat|oas|rtr|rt|dt|cbt|ptt|ft|ffct|imt|soat|agent|wt)-[A-Za-z0-9_-]{20,}
```

Seven prefixes added: `glrtr-` (runner registration), `glft-` (feed),
`glffct-` (feature-flags client), `glimt-` (incoming mail), `glsoat-` (SCIM
OAuth), `glagent-` (Kubernetes agent), `glwt-` (workspace). Source: GitLab's
token documentation, which enumerates the full set.

`rtr` precedes `rt` for legibility only — JS alternation backtracks between
alternatives, so `gl(?:rt|rtr)-` already matches `glrtr-`. The order is not
load-bearing and no test should pin it as if it were.

**Enumeration, not `gl[a-z]{2,6}-`.** The wildcard form matches `global-`
followed by 20 characters of `[A-Za-z0-9_-]` — `global-configuration-manager-x`
is a false positive, and hyphenated identifiers of that shape are ordinary in
build logs. Enumeration costs a line per GitLab release; a false positive costs
evidence.

`_gitlab_session=` is **not** added. It is a cookie, not a prefixed token; it
belongs to whatever row covers `Cookie:` headers, and inventing a session-cookie
detector here would be scope creep into an unmeasured carrier.

### 3c. `connection_string_secret` — separators and quoted values

```
(?=[^;\s])(?<=(?:^|;)\s{0,8}(?:password|accountkey|sharedaccesskey|sharedaccesssignature|userpassword)\s{0,8}=\s{0,8})(?:"(?:[^"]|""){8,8192}"|'(?:[^']|''){8,8192}'|[^;\s]{8,})
```

Three `\s{0,8}` gaps and two quoted alternatives.

- **Bounded gaps.** `\s{0,8}` keeps the lookbehind bounded-length. `\s*` would
  make it unbounded-variable-length — the exact shape this table spent a change
  removing. Eight covers `; Password`, `Password = `, and `;\n` plus a normal
  indent; a config with nine spaces before `Password` is a disclosed loss.
- **`\s`, not `[ \t]`.** The `;\n` form is what pretty-printed
  `appsettings.json` and Azure portal output actually look like.
- **The guard stays exactly correct.** The body's first-character set is
  `{"} ∪ {'} ∪ [^;\s]`, and both quotes are in `[^;\s]`, so the union is
  `[^;\s]` — unchanged. The guard remains a precise equality, not an
  approximation.
- **ADO.NET doubled delimiters are content.** Inside a quoted value, `""` and
  `''` escape a literal delimiter. Each quoted branch consumes those pairs
  before accepting a single closing delimiter, so a successful finding never
  leaves an escaped-quote tail visible.
- **Quoted runs are bounded at 8192, and the bound is cost-free.** `"[^"]{8,}"`
  is an unbounded run before a required literal, but it sits behind an anchor, so
  few start positions reach it — the same shape `api_key_header` ships. Swept
  4096 / 8192 / 16384 / 65536 on the unterminated-quote seed: **4.7–4.9 ms at
  2 MB, 9.2–9.7 ms at 4 MB, growth x1.98–2.03, benign 200 KB log 0.65–0.70 ms**
  — indistinguishable. Coverage scales exactly with the bound (a `;`-bearing
  quoted value of length *bound* is redacted; longer is not). So the choice is
  not time, it is **which failure you prefer**:

  | bound | too small | too large |
  |---|---|---|
  | — | long `;`-bearing quoted value leaks | malformed unterminated quote over-redacts up to *bound* |

  8192 matches the password bound `url_basic_auth` already carries, chosen there
  for the same reason: real credentials in that position reached ~2.5 KB (a JWE,
  an AWS RDS IAM token), so 8192 is ~3x headroom. It caps over-redaction at 8 KB.

- **Length alone never leaks.** A quoted value *over* the bound falls through to
  the unquoted alternative, which is unbounded, so it is still redacted whole.
  Only length **and** an interior `;` leak, because the unquoted run stops at the
  delimiter. This is measured, not assumed — an earlier draft of this spec
  claimed the run "gives up past the bound", which is false.
- **The 8-character floor is kept.** `Password="ab"` still leaks. Lowering the
  floor is what makes `password=` a false-positive engine; this is a disclosed
  loss, consistent with every other floor in the table.

## 4. What must be measured, not argued

`\s{0,8}` multiplies the lookbehind's internal alternatives, and the guard
`(?=[^;\s])` prunes almost nothing because nearly every character is in
`[^;\s]` — so the lookbehind runs at nearly every position with a larger
constant. Growth per input doubling at 100/200/400 KB must stay ~2.0 on a seed
of the detector's own anchor with no terminator, and the benign-log constant
must stay in the same order as before. If growth exceeds 2.0, the `\s{0,8}`
gaps shrink or split, not the guard.

**Measured** (quiet box, 10 cores, load 5.1, node v25.8.2; rungs 512 KB-4 MB
because at 100-400 KB these rows land at 0.2-3 ms where the timer floor
dominates and the ratios are meaningless):

| seed | 512 KB | 1 MB | 2 MB | 4 MB | growth |
|---|---|---|---|---|---|
| `conn`: bare anchor run | 2.15 | 4.24 | 8.66 | 18 | **x2.03** |
| `conn`: maximal `\s{0,8}` gaps | 2.00 | 3.93 | 7.95 | 16 | **x2.07** |
| `conn`: unterminated quote | 1.18 | 2.46 | 5.03 | 10 | **x2.06** |
| `gitlab`: anchor run | 0.54 | 0.91 | 1.82 | 3.70 | **x2.03** |
| `slack`: anchor run | 1.44 | 2.91 | 5.75 | 12 | **x2.03** |

Benign 200 KB build log, constant not growth: `connection_string_secret`
0.52 -> **0.82 ms** (the `\s{0,8}` gaps cost 1.6x, as predicted),
`gitlab_token` 0.03 -> 0.03, `slack_webhook_url` 0.54.

## 5. Disclosed losses this change creates

Recorded so they are not rediscovered as bugs:

| shape | outcome |
|---|---|
| `Password` + 9 or more spaces + `=` | not redacted (gap bound is 8) |
| `Password="ab"` (quoted, under 8 chars) | not redacted (floor kept) |
| quoted value over 8192 chars **with an interior `;`** | not redacted — and if the `;` sits within the first 8 characters, nothing fires at all |
| `_gitlab_session=<cookie>` | not redacted (out of scope, see §3b) |
| Slack webhook path under 16 chars | not redacted (floor) |

One **over**-redaction, recorded for the same reason: a value whose closing quote
is missing lets the run reach the next quote in the input, taking the following
field name with it (`a=1;Password="unterminated;Other=zzz…";b=2` →
`a=1;Password=[REDACTED];b=2`). Malformed input, and erring toward redacting more
is the safe direction for a secret — but it is a behaviour, so it is pinned.

## 6. Measurement discipline note

Every timing figure in this spec was taken **after** killing 60 orphaned vitest
workers and 30 orphaned busy-wait shells (`while :; do :; done`, spawned by a
deleted `lock-steal` worktree's lock-contention benchmark whose `kill $HOGS`
never ran) that had been running 16 h 52 m and held the 10-core box at **load
124**. On that box the same provably-linear patterns measured growth ratios
between **x0.97 and x13.70**, non-monotonically. min-of-N does not rescue this:
at that load there is no quiet slice to find. `redos-probe.mjs carriers` now
refuses to print a number when 1-min load exceeds 0.75 x cores.
