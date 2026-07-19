# `jwt` Detector ReDoS Fix — Design

- **Date:** 2026-07-20
- **Status:** user-approved design; approach and trade-off re-confirmed
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

### 1b. Severity — corrected

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

## 2. Goal and invariant

Make the detector linear without losing coverage of real JWTs.

> The regex's matching behavior changes in exactly one respect: a JWT
> immediately preceded by a base64url character (`[A-Za-z0-9_-]`) with no
> delimiter no longer matches. Every other input — including every large
> real JWT — produces byte-identical output. No other detector, and no
> function signature, changes.

## 3. The fix

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

## 5. Accepted trade-off

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

## 6. Testing

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
convention. Two or three lines naming both facts: the lookbehind
collapses O(n) useless start positions to O(1), and the `-`/`_` loss is
an accepted trade-off per §5 of this spec.

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

Changeset: `@megasaver/policy` **patch** — the API is unchanged and the
package is past 1.0, so the version is right. The changeset **body must
state the behavior change in one sentence**: a JWT preceded directly by a
base64url character (including `-` and `_`) no longer redacts, and why
that is intended per §5. Patch is defensible; silence about a
security-relevant behavior change is not.

Wiki: update `entities/policy` and append to `log.md`, including the
corrected severity classification (adversarially reachable, not triggered
by ordinary base64 logs) so the record does not carry the original
overstatement.
