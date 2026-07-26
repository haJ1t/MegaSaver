---
"@megasaver/policy": minor
---

Close the three carrier gaps §5b disclosed and left open. Twelve shapes that
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
