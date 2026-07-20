# `jwt` Detector ReDoS Fix — Design

- **Date:** 2026-07-20
- **Status:** **AMENDED 2026-07-20b — see §0 before reading further.**
  Three review passes found the §5 scope claim false, the §5 cost
  argument inapplicable to the percent class, the §1b severity
  understated, and the §6 suite unable to fence the next edit. §0, §1b,
  §2, §5, §6 and §9 are corrected; superseded text is preserved inline
  in `<details>` blocks rather than deleted.
- **Status (original, 2026-07-20):** user-approved design; approach and trade-off re-confirmed
  2026-07-20 against the **corrected** trade-off table, after the security
  gate showed the loss is larger than first presented (§5). Architect pass
  **APPROVE_WITH_FIXES** and security-reviewer pass **APPROVE_WITH_FIXES**
  applied — the security reviewer independently reproduced every
  measurement and attacked the fix with 17 structured shapes plus 400
  randomized fuzz trials without finding anything super-linear.
- **Risk:** CRITICAL (§12 — evidence-preserving redaction core). The `jwt`
  detector is a LOCKED §9d baseline entry consumed by every redaction
  sink: the proxy output path, `mega output exec`, the saver/guard/intent
  hooks, brain export, hot handoff open/inspect, the firewall ledger, and
  the GUI bridge. Mandatory chain: HIGH chain + `omc:tracer` evidence loop
  + `security-reviewer` + verifier with reproduction evidence + this
  manual user-confirmation record. Worktree required;
  `autopilot`/`ralph`/any unsupervised loop forbidden.
- **Origin:** found by the security gate on the redaction-baseline
  extension spec and recorded as a follow-up in
  `2026-07-19-redaction-baseline-extension-design.md` §14. Pre-existing in
  shipped code; no in-flight branch introduced it.

## 0. Amendment 2026-07-20b — scope correction and percent recovery

**Status:** amends the 2026-07-20 approved design after three further
review passes. The original record below is kept intact; the sections it
corrects are marked. Nothing here reverses the fix — it widens it and
restates its cost honestly.

Three things in the original were wrong or understated:

1. **§5's scope claim was false.** It asserted that "every standard JWT
   carrier uses `=`, `:`, `"`, `;`, whitespace, or start-of-string as its
   delimiter, and all are preserved." Percent-escapes break that claim
   outright, and they are among the most common carriers in the agent
   output this detector exists to scrub. Corrected in §5.
2. **§5's cost argument did not transfer to the percent class.** The
   "too expensive to recover" measurement was taken for `-`/`_`, which
   sit *inside* the run character class. `%` does not, so it terminates
   the dotless run and recovery is nearly free. Corrected in §5.
3. **§1b's severity was wrong in the other direction.** The blowup is
   **ordinarily reachable**, not merely adversarially reachable.
   Corrected in §1b.

**The amended pattern** — this is what ships:

```
/(?:(?<![A-Za-z0-9_-])|(?<=%[0-9A-Fa-f][0-9A-Fa-f]))eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
```

The tail after the alternation is byte-identical to the shipped pattern's
tail; the only change is that the single lookbehind becomes a two-branch
alternation, adding `(?<=%[0-9A-Fa-f][0-9A-Fa-f])`.

**Changeset is `minor`, not `patch`** (§9 corrected). A reduction in
redaction coverage must not ride in on an auto-merged patch, even though
the public API is unchanged.

### 0a. What is recovered, and what is still lost

**Recovered:** a JWT immediately preceded by a percent-escape. Verified
across **all 512 `%XY` forms** (256 byte values x upper- and lower-case
hex): 0/512 redact under the shipped pattern, 512/512 under the amended
one.

**Still lost — the true loss class.** Any JWT immediately preceded by a
*raw base64url character*, i.e. exactly `[A-Za-z0-9_-]`. A 256-byte
predecessor sweep confirms the boundary is exactly those 64 bytes and no
others (192 of 256 bytes admit a match). The concrete shapes:

| shape | example | other detector covers the JWT bytes? |
|---|---|---|
| `session-` glue | `session-<jwt>` | no detector matches at all |
| `id_token_` glue | `id_token_<jwt>` | no detector matches at all |
| `Bearer` with no space | `Authorization: Bearer<jwt>` | no — `bearer_token` requires `\s+` |
| GitHub App installation token | `ghs_<appid>_<jwt>` | `github_token` fires but stops at the `_`; JWT bytes leak |
| raw base64 run glue | `QUJDREVGRw<jwt>` | no detector matches at all |

**No other detector provides fallback coverage for any of these.** Run
through the real sequential-replacement pipeline (all 20 baseline
patterns, declaration order, faithful to `redactWithFindings`), every row
above leaves the complete signature `SflKxwRJSMeKKF2QT4` in cleartext.
The `ghs_` row is the sharpest: `github_token` *does* fire, which makes
`findings` non-empty and the leak easy to miss, but it redacts only the
`ghs_...` prefix and the whole JWT survives. `url_query_secret` cannot
rescue any of them — its own lookbehind needs a literal `=`.

### 0b. Escaped-equals forms — measured, not assumed

The review flagged `\x3d`-style escaped equals alongside the percent
forms. Measured individually, they do **not** behave alike:

| form | example | shipped | amended | why |
|---|---|---|---|---|
| `%3D` / `%3d` | `state=x%3D<jwt>` | lost | **recovered** | `%` is outside the run class |
| `\x3d` / `\x3D` | `state=x\x3d<jwt>` | lost | **still lost** | predecessor byte is `d`/`D`, a base64url char |
| `\u003d` | `state=x\u003d<jwt>` | lost | **still lost** | predecessor byte is `d` |
| `&#61;` | `state=x&#61;<jwt>` | **already redacted** | redacted | predecessor byte is `;`, a preserved delimiter |

So: the percent branch recovers the percent class only. `\x3d` and
`\u003d` remain in the accepted-loss class of §5 and are named there.
`&#61;` was never affected — the review's grouping of it with the others
was incorrect.

### 0c. Cost of the recovery — why the original rejection did not transfer

The original §5 rejected a hybrid alternation at **49.7 ms** per 313 KiB
versus 0.4 ms for the simple fix. That measurement was for a
bounded-header branch after `-`/`_`, both of which are *inside*
`[A-Za-z0-9_-]`, so an admitted start still scans a long dotless run.
`%` is not in the class, so it terminates the run and each admitted start
costs O(its own token).

Measured on this branch (Node 22, best of 3, 313 KiB):

| seed | shipped | amended |
|---|---|---|
| `eyJaA0` | 0.47 ms | 0.51 ms |
| `-eyJaA` | 0.15 ms | 0.25 ms |
| `_eyJaA` | 0.15 ms | 0.24 ms |
| `%3DeyJaA` | 0.13 ms | 0.32 ms |

Two orders of magnitude under the 49.7 ms hybrid, four under the
7,481 ms original. The percent branch adds a constant, never a factor of
input length.

### 0d. Linearity of the new branch — attacked, not assumed

The second lookbehind branch is new, so it is the likeliest place to
reintroduce cost. Thirteen seeds across 156 / 313 / 626 / 1252 KiB, best
of 3 (ms):

| seed | 156K | 313K | 626K | 1252K | doubling |
|---|---|---|---|---|---|
| `eyJaA0` | 0.25 | 0.53 | 1.06 | 1.98 | 2.16 / 1.99 / 1.87 |
| `-eyJaA` | 0.13 | 0.23 | 0.48 | 0.96 | 1.73 / 2.11 / 1.98 |
| `_eyJaA` | 0.12 | 0.23 | 0.45 | 1.00 | 1.97 / 1.99 / 2.21 |
| `%3DeyJaA` | 0.17 | 0.34 | 0.63 | 1.25 | 1.94 / 1.87 / 2.00 |
| `%41eyJaA` | 0.16 | 0.31 | 0.61 | 1.39 | 1.93 / 2.01 / 2.27 |
| `%3deyJ`+64 dotless | 0.23 | 0.47 | 1.07 | 1.95 | 2.04 / 2.27 / 1.81 |
| two-segment fail | 0.60 | 1.24 | 2.55 | 4.88 | 2.05 / 2.06 / 1.92 |
| `%3D` two-segment fail | 0.59 | 1.20 | 2.30 | 4.80 | 2.04 / 1.92 / 2.09 |
| `.`-separated starts | 0.17 | 0.48 | 0.60 | 1.28 | 2.83 / 1.24 / 2.14 |
| near-miss JWTs | 0.26 | 0.61 | 1.04 | 2.11 | 2.34 / 1.70 / 2.03 |
| 4 KiB dotless run + `%3DeyJ` | 0.17 | 0.42 | 0.69 | 1.39 | 2.40 / 1.67 / 2.00 |
| `%3D` dense | 0.04 | 0.08 | 0.15 | 0.30 | 2.00 / 1.99 / 2.00 |
| `%3DeyJ` dense | 0.14 | 0.29 | 0.58 | 1.20 | 2.01 / 2.00 / 2.07 |

Every ratio sits at ~2.0 per doubling: linear. A segment-length sweep
from 1 to 65,536 at 1252 KiB peaks at **4.72 ms** (segment length 64,
~3.87 ms/MiB) — statistically the same as the shipped pattern's own worst
case of 4.94 ms on the equivalent shape. Twelve pathological `%` shapes
(`%%3D`, `%3D%3D`, invalid hex `%GG`, `%0A`, bare `%`) all land between
0.03 and 0.71 ms per 313 KiB. A 500-seed randomized fuzz comparing 313 to
626 KiB produced a maximum ratio of 2.94x with **zero** seeds above 3x.

Nothing super-linear was found.

### 0e. No new false positives

The amended pattern is a strict superset of the shipped one and a strict
subset of the pre-fix one. Across 441,957 candidate matches drawn from
300,000 randomized inputs, **every** match was also a structurally valid
match for the pre-fix pattern — the percent branch changes only *where a
match may start*, never *what counts as a token*. Twelve
deliberately-crafted near-miss strings (`%3Deyjnotatoken`, `%3DeyJ..`,
`%3DeyJonly.onedot`, `100%3Done`, ...) fire zero times. A 256-byte
single-predecessor sweep shows zero verdict drift between shipped and
amended, confirming the new branch fires only on a genuine two-character
hex escape.

---

## 1. Problem

`packages/policy/src/redaction-patterns.ts` entry `jwt`:

```
/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
```

Measured against `'eyJaA0'.repeat(n)` on Node 22 (best of 3 runs):

| input | time |
|---|---|
| 39 KiB | 113.2 ms |
| 156 KiB | 1,914.4 ms |
| 313 KiB | 7,481.5 ms |

A clean ~4× per doubling: **quadratic**, O(starts × length). Not
exponential, and not classic nested-quantifier catastrophic backtracking.

### 1a. Root cause — corrected

The follow-up note that opened this work stated the cause as "the
separator is NOT excluded from the runs' character classes." **That is
wrong**: `[A-Za-z0-9_-]` does not match `.` — verified directly. The
consequence matters, because it means the obvious remedy of "exclude the
dot" is a no-op.

The actual mechanism, established by measurement rather than reading:

1. Every `eyJ` occurrence is a candidate start position.
2. At each, `[A-Za-z0-9_-]+` greedily consumes to the end of the class
   run — the entire remaining input when the run contains no dot.
3. The mandatory `\.` then fails, and the engine backtracks one character
   at a time across everything it consumed. Every one of those retries
   also fails, because giving back a character leaves a class character
   where `\.` is required.
4. So each start position costs O(remaining length), and there are O(n)
   start positions.

Isolating the two variables confirms it. At 39 KiB with 6,800 `eyJ`
starts: **204.2 ms**. At the same 39 KiB with exactly **one** `eyJ` start:
**0.0 ms**. The driver is the number of start positions, not the length of
any single run.

### 1b. Severity — corrected, then corrected again (Amendment 2026-07-20b)

> **This section's original conclusion — "adversarially reachable, not
> ordinarily reachable" — is WRONG and is superseded.** Measurement below
> refutes it. The original text is retained after the correction as a
> record of what was believed at approval time.

**Corrected classification: ordinarily reachable.**

The original reasoning assumed random base64 rarely contains `eyJ`. That
is true, but it is the wrong population. Base64 of *JSON* is not random:
JSON objects begin `{"`, which encodes to `eyJ`, so every encoded JSON
value contributes an `eyJ` at a predictable alignment. Encoded-JSON
payloads are routine in agent output.

What actually decides the cost is whether the encoded text forms one long
**dotless run of `[A-Za-z0-9_-]`**. Measured at 320 KiB with the pre-fix
pattern:

| shape | `eyJ` count | longest run | pre-fix | amended |
|---|---|---|---|---|
| base64 (`+/`), newline-separated | 3,430 | 94 | 0.8 ms | 0.45 ms |
| base64 (`+/`), no separator | 3,466 | 11,866 | 5.6 ms | 0.46 ms |
| **base64url (`-_`), newline-separated** | 3,479 | 94 | 0.4 ms | 0.45 ms |
| **base64url (`-_`), no separator** | 3,516 | 327,680 | **575.9 ms** | **0.31 ms** |
| base64url, no separator, larger records | 695 | 327,680 | 113.4 ms | 0.41 ms |

The hazard is **base64url with no separator**, and it scales cleanly
quadratically — 85 / 171 / 341 / 683 KiB costs 40.6 / 165.6 / 637.6 /
2,555.5 ms, a clean 4x per doubling.

This is an ordinary shape, not a crafted one: `Buffer.toString("base64url")`
of any JSON payload produces it, and a single-line log record carrying one
long base64url field is exactly this. Standard base64 (`+` and `/` break
the run) and any newline wrapping are both benign — which is the honest
boundary of the claim.

**Two review examples do not hold.** Kubernetes Secrets and Docker
`config.json` auth blobs were cited as instances. Both use *standard*
base64 and are newline-wrapped in practice; measured at ~320 KiB they
cost **1.0 ms** and **2.1 ms** respectively under the pre-fix pattern.
They are not the vector. The vector is base64url-without-separators.

**No effective size cap sits in front of redaction.** The high-volume
sinks redact the full raw capture before any truncation:
`output-filter/src/types.ts:182` (`redactWithFindings(raw)`, ahead of
`maxReturnedBytes`), `context-gate/src/record-output.ts:158`
(`redact(input.raw)`), and `context-gate/src/run-command.ts:305,574`
(where the `.slice(0, 4000)` is applied to the *result* of `redact()`,
deliberately, so a truncated fragment is not left unrecognised). The
caps that do exist are the 20 MB capture ceiling
(`DEFAULT_MAX_BYTES = 20_000_000` in `apps/cli/src/commands/output/exec.ts`
and `bench.ts`) and the daemon's 16 MB body limit — both far above the
683 KiB that already costs 2.5 s, so under the pre-fix pattern they bound
nothing that matters.

It remains worth fixing on the CRITICAL tier for the original reason as
well: the redactor processes untrusted agent output, tool results, and —
since Hot Handoff — the contents of packets authored elsewhere.

<details>
<summary>Original §1b text as approved 2026-07-20 (superseded)</summary>

The follow-up note claimed the blowup is "reachable from ordinary
base64-heavy logs," citing 9.93 ms for a 24.6 KiB unbroken base64 run.
**Measured: 0.00 ms.** Random base64url contains `eyJ` with probability
≈ (1/64)³ ≈ 1/262,144 per position, so a 24 KiB blob is expected to hold
about 0.1 occurrences — nowhere near enough to matter.

The blowup needs *many* `eyJ` occurrences in text that contains *no*
dots. Text full of real JWTs is fast (the dots satisfy `\.` immediately —
measured 0.0 ms). So the honest classification is **adversarially
reachable, not ordinarily reachable**.

It remains worth fixing on the CRITICAL tier: the redactor processes
untrusted agent output, tool results, and — since Hot Handoff — the
contents of packets authored elsewhere. A crafted payload stalls every
sink, and the redaction path is exactly where an attacker would aim.

</details>

## 2. Goal and invariant

Make the detector linear without losing coverage of real JWTs.

> The regex's matching behavior changes in exactly one respect: a JWT
> immediately preceded by a base64url character (`[A-Za-z0-9_-]`) with no
> delimiter no longer matches. Every other input — including every large
> real JWT — produces byte-identical output. No other detector, and no
> function signature, changes.

**Amended 2026-07-20b — the invariant above needs one carve-out, stated
exactly.** Hex digits are themselves base64url characters, so a
percent-escape ends in a character that is *in* the class. The amended
pattern still matches there. The precise invariant is:

> A JWT no longer matches when it is immediately preceded by a raw
> base64url character, **except** where that character is the final digit
> of a two-digit percent-escape (`%XY`), in which case it still matches.
> Everything else is byte-identical to the pre-fix pattern.

Verified two ways: a 256-byte single-predecessor sweep (exactly the 64
base64url bytes block, the other 192 admit, zero drift from the
single-lookbehind pattern), and a 300,000-input randomized differential in
which all 441,957 amended-pattern matches were also structurally valid
pre-fix matches. The amended pattern is a strict superset of the shipped
one and a strict subset of the pre-fix one.

Worth recording plainly: the invariant **as originally written was false
for the stage-one pattern** — it lost the percent carriers too, and the
sentence did not say so. That gap is what Amendment 2026-07-20b exists to
close.

## 3. The fix

> **Amended 2026-07-20b — this is stage one, not what ships.**
> The pattern in this section removes the quadratic but loses the
> percent-escaped carriers. The shipping pattern adds a second
> lookbehind branch and is stated in §0. Everything below about
> *why* the lookbehind makes the scan linear still applies
> unchanged to both branches.


```
/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
```

One added lookbehind. Inside a long dotless run such as
`…aA0eyJaA0eyJ…`, every `eyJ` after the first is preceded by a class
character and is rejected before any scanning begins, so the O(n) useless
start positions collapse to O(1).

Measured, best of 3:

| input | current | fixed |
|---|---|---|
| 39 KiB | 113.2 ms | 0.06 ms |
| 156 KiB | 1,914.4 ms | 0.23 ms |
| 313 KiB | 7,481.5 ms | **0.43 ms** |
| 626 KiB | (too slow to measure) | 0.92 ms |
| 1,252 KiB | (too slow to measure) | 1.83 ms |

Linear, and ~17,400× faster at 313 KiB.

The fix's own worst case is not delimiter-separated starts (0.47 ms at
313 KiB) but a **two-long-segment failing token** — `eyJ<64 chars>.eyJ<64
chars>.<non-class>` tiled — at 1.26 ms, because each admitted start scans
both runs before failing on the empty third segment. A segment-length
sweep from 1 to 65,536 peaks at 4.63 ms per 1,252 KiB (~3.7 ms/MiB).
Both shapes are linear; the review that found this measured 17 structured
attack shapes plus 400 randomized fuzz trials and found nothing
super-linear.

The structural reason the fix is linear, not merely faster: the run class
and `\.` are disjoint, so run 1 and run 2 each have exactly one viable
split and every backtrack step fails in O(1), while run 3 has no
successor and never backtracks. Each admitted start therefore costs O(its
own token), not O(remaining input).

This is the same left-boundary technique the security reviewer required
for the context-gated detectors in the extension spec (§4b there), so it
is consistent with the baseline's own conventions rather than a new idea.

## 4. Rejected alternatives — both measured, not assumed

**Segment length bounds** (`eyJ[A-Za-z0-9_-]{1,N}\.…`), the first remedy
proposed in the follow-up note. Linear, but ~40× slower than the
lookbehind (18.4 ms vs 0.43 ms at 313 KiB with a 200-char header bound)
**and it loses real coverage**: with a 512-char header bound an x5c
certificate-chain header (900 B or 3 KB) and a 16 KB-payload ID token
stop matching entirely — the whole token stays in cleartext. Trading a
DoS for a silent coverage regression on an existing detector is the wrong
trade. Rejected.

**Atomic-group emulation** (`eyJ(?=([A-Za-z0-9_-]+))\1\.…`). Semantically
identical to the current pattern — verified byte-identical across 13
inputs including a 8 KB-payload JWT, which follows from the class and the
separator being disjoint, so backtracking can never find a match the
atomic form misses. But it **does not fix the performance**: 5,870 ms at
313 KiB versus the current 7,346 ms. The cost is not the backtracking, it
is scanning the run at every start position, and the lookahead still
scans. Rejected — and recorded here because it is the natural first idea.

## 5. Accepted trade-off — corrected (Amendment 2026-07-20b)

> **The original §5 overstated what is preserved.** Its claim that "every
> standard JWT carrier uses `=`, `:`, `"`, `;`, whitespace, or
> start-of-string as its delimiter, and all are preserved" is **false**:
> percent-escaped carriers were not considered, and they are common. The
> original text is retained at the end of this section as a record of the
> approved decision; the corrected statement is what governs.

**The loss class, stated precisely.** A JWT is not redacted when it is
immediately preceded by a **raw base64url character** — exactly
`[A-Za-z0-9_-]`, all 64 of them. A 256-byte predecessor sweep confirms
those 64 bytes block and the other 192 admit; there is no other blocking
byte and no other exception.

Percent-escaped predecessors, which the original section missed entirely,
are **recovered** by the amended pattern (§0a). All 512 `%XY` forms
redact.

**The concrete shapes still lost**, each verified through the full
sequential-replacement pipeline with **no other detector covering the JWT
bytes** (§0a has the table):

```
session-eyJhbGci....eyJ....sig
id_token_eyJhbGci....eyJ....sig
Authorization: Bearer<jwt>          (bearer_token needs \s+)
ghs_<appid>_<jwt>                   (github_token fires, stops at the _)
QUJDREVGRw<jwt>                     (raw base64 run glue)
state=x\x3d<jwt>                    (escaped equals; predecessor is `d`)
state=x\u003d<jwt>                  (same)
```

`&#61;`-escaped equals is **not** in this class — its predecessor is `;`,
a preserved delimiter, and it redacts (§0b).

**Why these cannot be recovered the way the percent class was.** The
percent class is cheap precisely because `%` lies *outside*
`[A-Za-z0-9_-]`, so it terminates the dotless run and each admitted start
costs O(its own token). Every shape above is preceded by a character
*inside* the class. Admitting them means an admitted start can scan an
arbitrarily long dotless run, which is the quadratic itself. Narrowing
the lookbehind to `(?<![A-Za-z0-9])` — the obvious "fix" — restores
`session-` and `id_token_` and restores the full quadratic with them:
measured on this branch at 313 KiB, **7,728 ms** against
`'-eyJaA'.repeat(n)` and **7,416 ms** against `'_eyJaA'.repeat(n)`, while
the `'eyJaA0'` seed still reads 0.6 ms and would sail through any
ceiling. The `-` and `_` must stay in the lookbehind class. §6 pins this
with dedicated timing seeds, because it is exactly the edit a future
maintainer would make to close this section.

**This is a real, disclosed coverage reduction.** It is not "nothing
would parse it as a token either" — `session-<jwt>` and `ghs_<appid>_<jwt>`
are live token shapes. It is accepted because the alternative is a
quadratic ReDoS in a CRITICAL redaction path that is, per corrected §1b,
ordinarily reachable. The changeset is **minor** (§9) so the reduction is
visible at release rather than auto-merged as a patch.

<details>
<summary>Original §5 text as approved 2026-07-20 (superseded — contains the false scope claim)</summary>

A JWT preceded directly by any base64url character — `[A-Za-z0-9_-]`,
**including `-` and `_`** — no longer redacts.

Naming the two punctuation characters explicitly matters, because they
make the loss larger than "glued to a random base64 blob" suggests. Both
of these stop redacting, verified through the full `redact()` pipeline
(findings go from `{jwt: 1}` to `{}`, the complete token left in
cleartext, and no other detector picks it up — `url_query_secret`
requires an `=`, which these shapes lack):

```
session-eyJhbGci….eyJ….sig
id_token_eyJhbGci….eyJ….sig
```

An earlier draft of this section justified the loss with "nothing would
parse it as a token either." That is wrong for `-` and `_` and has been
removed.

**Why the class cannot be narrowed to recover them.** Narrowing the
lookbehind to `(?<![A-Za-z0-9])` restores those two shapes and
reintroduces the full quadratic: measured 7,714 ms at 313 KiB against
`'-eyJaA'.repeat(n)` and 7,437 ms against `'_eyJaA'.repeat(n)`. The `-`
and `_` characters must stay in the lookbehind class. §6.2 pins this with
dedicated timing seeds, because the narrowing is exactly the edit a
future maintainer would make to "fix" this section's trade-off.

**Why the loss is accepted rather than engineered around.** A hybrid
alternation (full lookbehind, or a bounded-header branch after `-`/`_`)
was measured: it recovers both shapes and stays linear, but costs 49.7 ms
at 313 KiB versus 0.4 ms — 125× the simple fix — adds a two-branch
pattern to a LOCKED entry, and still loses an x5c-heavy header in the
`-`/`_` position. Every standard JWT carrier uses `=`, `:`, `"`, `;`,
whitespace, or start-of-string as its delimiter, and all are preserved
(§6.1). Decision recorded 2026-07-20 with the corrected trade-off table
in front of the approver.

§6.3 asserts both non-matches explicitly, so a future reader sees an
intended boundary rather than a gap.

</details>

## 6. Testing — amended (Amendment 2026-07-20b)

> **The original §6 plan produced a suite that does not fence the next
> edit.** Mutation testing (below) found that of the 21 assertions that
> shipped, the *only* one killing any structural mutant is the
> source-prefix string check — and that check breaks on the amended
> pattern itself. Once it is updated, **four of five mutants survive the
> whole suite**. The original text is retained at the end of this section.

### 6.0 Mutation evidence (why this section changed)

Five mutants applied to the amended pattern, run against the 21
assertions currently in `packages/policy/test/redact-jwt.test.ts`:

| mutant | killed by current 21? | killed by behavioural 20 only? |
|---|---|---|
| M1 delete the `/g` flag | only by the source-prefix check | **survives** |
| M2 signature class to `[A-Za-z0-9]` | only by the source-prefix check | **survives** |
| M3 header class to `[A-Za-z0-9]` | only by the source-prefix check | **survives** |
| M4 payload class to `[A-Za-z0-9]` | only by the source-prefix check | **survives** |
| M5 segment bounds `{15,}/{20,}/{15,}` | only by the source-prefix check | **survives** |

The source-prefix check is doing all the work, and it is doing it for the
wrong reason: it pins a *string prefix of the source*, not any behaviour.
It also fails against the amended pattern, which no longer *starts with*
`(?<![A-Za-z0-9_-])`.

Root cause of the behavioural blindness, measured on the existing corpus:
the 14 equivalence inputs contain only **47 of the 64** base64url
characters, missing `C E L V X Z m p q s v 5 6 7 8 - _`. In particular
**no fixture token contains `-` or `_` in any segment** — which is why
narrowing any segment class to `[A-Za-z0-9]` is invisible. M2 alone would
put 43 characters of live signature into cleartext.

### 6.1 Required assertions

Everything in the original plan stands, plus the following. Each line
names the mutant it kills; all were verified to kill it.

1. **Structural gate — rewritten for the two-branch pattern.** The old
   `startsWith("(?<![A-Za-z0-9_-])")` no longer holds. Replace with:

   ```ts
   expect(jwtEntry.pattern.source.startsWith(
     "(?:(?<![A-Za-z0-9_-])|(?<=%[0-9A-Fa-f][0-9A-Fa-f]))",
   )).toBe(true);
   ```

   Verified: true for the amended pattern, **false** for both the
   narrowed-lookbehind mutant and the pre-amendment shipped pattern, so
   it still catches the edit §5 warns about.

2. **Flag assertion — new.** No test in the repo asserts `.flags` on any
   pattern, and `redact()` derives `count` from a global replace, so
   dropping `/g` silently under-reports every finding and leaves every
   JWT after the first in cleartext.

   ```ts
   expect(jwtEntry.pattern.flags).toBe("g");
   ```

   Kills **M1**.

3. **A fixture whose header, payload and signature each contain `-` and
   `_`.** This is the single highest-value addition; the corpus has no
   such token today.

   ```
   eyJhbGciOiJIUzI1NiJ9-_x.eyJzdWIiOiIxMjM0NTY3ODkwIn0-_y.SflKxw-RJSMeKKF_2QT4
   ```

   Kills **M2, M3 and M4**. (One fixture covers all three. If per-segment
   diagnosis is wanted, split it into three; the kill is equivalent.)

4. **A minimal `alg:none` token.**

   ```
   eyJhbGciOiJub25lIn0.eyJhIjoxfQ.X
   ```

   Kills **M5** — segment length bounds drop it, and it is a real shape
   (an unsigned token is precisely the one an attacker forges).

5. **Two JWTs in one input**, asserting both are replaced.

   ```
   a=<jwt> b=<jwt>   ->   a=eyJ[REDACTED] b=eyJ[REDACTED]
   ```

   Kills **M1** behaviourally, independent of the flag assertion.

6. **Percent-encoded equivalence cases** — the recovery this amendment
   ships, so it cannot silently regress. At minimum `%3D` (upper hex),
   `%3d` (lower hex), `%26` and `%20`:

   ```
   state=x%3D<jwt>  ->  state=x%3DeyJ[REDACTED]
   state=x%3d<jwt>  ->  state=x%3deyJ[REDACTED]
   a=b%26<jwt>      ->  a=b%26eyJ[REDACTED]
   q=%20<jwt>       ->  q=%20eyJ[REDACTED]
   ```

   Both hex cases are required: a mutant restricting the branch to
   `[0-9A-F]` would otherwise pass.

7. **A `%`-shaped timing seed** added to the existing three:
   `'%3DeyJaA'.repeat(n)` at the 313 KiB rung. Measured 0.32 ms.

   Be honest about what this seed does: it does **not** discriminate the
   narrowed-lookbehind mutant (0.3 ms either way). Its job is to guard
   the *new* branch against a future edit that makes branch 2 scan, which
   is the one structural risk this amendment introduces. The existing
   `-eyJaA` and `_eyJaA` seeds remain the ones that catch the §5
   narrowing (7,728 ms and 7,416 ms), and must not be removed.

8. **Non-match assertions extended** to the full loss class of corrected
   §5 — add `Bearer<jwt>` (no space), `ghs_<appid>_<jwt>`, and
   `state=x\x3d<jwt>` alongside the existing three, each with a comment
   naming §5. The `ghs_` case should assert the JWT bytes specifically,
   not merely that the string changed: `github_token` fires on that input
   and makes a naive "was it modified?" assertion pass while the token
   leaks.

9. **Existing suites unmodified**, as originally specified.

### 6.2 Note for the implementer

The old expected-value literals in the equivalence corpus stay valid —
all 14 were re-verified byte-for-byte against the amended pattern, and
against the pre-fix reference, on this branch. The amendment adds cases;
it does not rewrite existing ones.

<details>
<summary>Original §6 text as approved 2026-07-20 (superseded)</summary>

1. **Equivalence corpus — expected outputs frozen, old pattern not
   shipped into CI.** The 14-case corpus becomes a test, but the old
   quadratic pattern is **not** compiled inside it. Run the old pattern
   once in the worktree, capture its output for each case, and commit
   those as byte-literal expected strings asserted against the new
   pattern only. Same pinning strength, no dead regex living in CI
   forever, and no 7.5-second pattern sitting under vitest's 30-second
   `testTimeout` waiting for the first contributor who appends a
   many-start case. The old-vs-new differential run is reproduction
   evidence for the plan document, not a test file.

   Cases: minimal HS256, typical RS256, RS512 with a large signature, an
   8 KB-payload ID token, a 16 KB payload, a 3 KB x5c header, and each
   delimiter carrier. **These assertions are pattern-level** — both
   regexes applied directly, not through `redact()`. That distinction is
   load-bearing for the `Authorization: Bearer eyJ…` case: `bearer_token`
   sits at index 5 and `jwt` at index 6, so in the real pipeline
   `bearer_token` consumes that token first and `jwt` never sees it.
2. **Timing regression — structural gate primary, wall clock as
   backstop.**

   The primary assertion is deterministic and cross-platform:

   ```ts
   expect(jwtEntry.pattern.source.startsWith("(?<![A-Za-z0-9_-])")).toBe(true);
   ```

   CI runs `ubuntu-latest` and `windows-latest`, and this repo has
   already seen wall-clock flakiness on a Windows runner. A 50 ms ceiling
   at the 39 KiB rung sits only ~2.3× below the broken pattern's 113 ms
   while sitting ~800× above the 0.06 ms pass value — a GC pause or AV
   scan clears that routinely. So the timer keeps **only the 313 KiB
   rung**, where the separation is four orders of magnitude (7,481 ms
   broken versus 0.43 ms fixed).

   The timing test seeds **three** strings, not one:
   `'eyJaA0'.repeat(n)`, `'-eyJaA'.repeat(n)`, and `'_eyJaA'.repeat(n)`.
   The last two are not decoration: with the lookbehind narrowed to
   `(?<![A-Za-z0-9])` — the exact edit someone would make to undo §5's
   trade-off — the first seed still scores 0.45 ms and sails through any
   ceiling, while the other two cost 7,714 ms and 7,437 ms. Without them
   the quadratic can return with CI green.
3. **Non-match assertions.** Explicit assertions that
   `session-<jwt>`, `id_token_<jwt>`, and a JWT glued to a random
   base64url run do not redact, each with a comment naming the §5
   trade-off, so nobody "fixes" them back into a quadratic.
4. **Existing suites unmodified.** `redact.test.ts` (which carries a JWT
   positive), `redact-pii.test.ts`, `redact-unstructured.test.ts`, and
   `redact.property.test.ts` all pass untouched.

</details>

## 7. Consumers and the lock record

No signature changes. `redact`, `redactWithFindings`, and
`redactForLedger` are untouched; `RedactResult` is unchanged; the finding
name stays `jwt`. No consumer code needs an edit.

**But the lock record does.** The LOCKED §9d baseline is not only a code
comment — it is a literal table in
`docs/superpowers/specs/2026-05-10-bb3-policy-design.md` §5a, which
records the `jwt` pattern verbatim. That is where the lock is declared,
so landing this fix without touching it leaves the authoritative record
contradicting shipped code, silently: the sibling extension plan
transcribes its snapshot from the compiled `RegExp` objects rather than
from that table, so nothing would ever flag the divergence.

Required in the same commit: update the `jwt` row in that §5a table and
append a one-line footnote under the table naming this spec as the
amending change and §5 as the intended behavior difference. The footnote
is the load-bearing part — that table already renders some entries
loosely — so amend, never silently rewrite.

**A WHY comment goes at the regex itself**, not only in the test. Seven
sibling entries in `redaction-patterns.ts` carry multi-line WHY comments
for exactly this kind of non-obvious constraint, and that is the file's
convention. Two or three lines naming three facts: the first lookbehind branch
collapses O(n) useless start positions to O(1); the second branch
recovers percent-escaped carriers cheaply *because* `%` sits outside
the run class; and the remaining raw-base64url-predecessor loss is an
accepted trade-off per corrected §5. The existing comment's line
"Narrowing the class to [A-Za-z0-9] recovers those two" must be kept —
it is the anti-regression note — but its "see test/redact-jwt.test.ts"
pointer now also covers the percent cases.

## 8. Interaction with the redaction-baseline extension

`docs/superpowers/plans/2026-07-19-redaction-baseline-extension-plan.md`
is written but not executed. Its Task 1 freezes a snapshot of the
original 19 detectors, including `jwt`'s `pattern.source`. The two
changes touch the same line, so whichever lands second updates one
snapshot entry:

- **This fix first:** the extension's Task 1 must pin the *fixed* `jwt`
  source, and its §9.5 ReDoS gate may then cover `jwt` as well —
  the exclusion carved out there exists only because of this defect.
- **Extension first:** this fix adds a snapshot-entry update to its own
  commit, exactly as that plan's Task 3 does for `private_key_block`.

Recommended order: **this fix first.** It is one line, it removes an
exclusion the extension spec had to write around, and it is a live
vulnerability while the extension is only new coverage.

Because that plan is written, hardcoded, and unexecuted, drift is silent
until someone runs it and reads a stale RED as a bug. This fix's commit
therefore carries an explicit edit list against it:

1. **Task 1's snapshot literal** hardcodes `jwt`'s source inline, and its
   step asserts GREEN against unmodified source. Update the literal to
   the fixed source, or that step fails and looks like a broken snapshot.
2. **The plan header's "single intended exception to the lock" framing**
   (referring to `private_key_block`) becomes false — there are two.
   Extend it, and re-check Task 3's mutation check, which is calibrated
   against that invariant.
3. **Task 6's §9.5 exclusion paragraph and its committed commit-message
   body** both state that the locked `jwt` detector is super-linear and
   tracked separately. After this fix that ships into git history as a
   falsehood. Rewrite both, and bring `jwt` into the ReDoS gate's scope —
   this is a decision, not a "may".

One collision needs no edit, recorded so the merge is expected rather
than investigated: the extension's structural ordering test derives
leading literals from `pattern.source` and its helper stops at any `(`
that is not `(?:`. This fix changes `leadingLiterals(jwt)` from `["eyJ"]`
to `[]`, which is exactly how the eleven existing lookbehind-gated
entries already behave.

## 9. Process

CRITICAL chain: this spec → architect pass → `security-reviewer` design
pass → `writing-plans` → worktree → TDD → `pnpm verify` + reproduction
evidence → `code-reviewer` AND `critic` (separate passes, author ≠
reviewer) → `omc:tracer` evidence loop → verifier.

Changeset: `@megasaver/policy` **minor** — amended 2026-07-20b. The
public API is unchanged, so `patch` was defensible on API grounds, but
this ships a **reduction in redaction coverage** (corrected §5), and a
security-relevant coverage reduction must not ride in on an auto-merged
patch. `minor` forces it to be seen at release. The changeset body must
state, in one sentence each: (a) a JWT preceded directly by a raw
base64url character — including `-` and `_` — no longer redacts, and no
other detector covers those shapes; (b) percent-escaped carriers are
recovered; (c) the quadratic ReDoS is removed.

Wiki: update `entities/policy` and append to `log.md`. **Amended
2026-07-20b:** the severity line must read **ordinarily reachable**, not
"adversarially reachable". The wiki text currently on this branch says
the latter and is wrong — see corrected §1b for the base64url
measurement (575.9 ms at 320 KiB, clean 4x-per-doubling scaling) and the
absence of any effective size cap in front of the redaction sinks.
