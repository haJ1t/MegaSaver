# `jwt` Detector ReDoS Fix — Design

- **Date:** 2026-07-20
- **Status:** user-approved design (fix approach + trade-off acceptance
  recorded 2026-07-20). Architect and security-reviewer design passes
  pending per the CRITICAL chain.
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

The fix's own worst case — many *delimiter-separated* `eyJ` starts, so the
lookbehind admits every one — was measured too: 313 KiB costs 0.4 ms,
because each admitted run terminates at its delimiter almost immediately.

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

A JWT glued directly to preceding base64url characters
(`…abc123eyJhbG….eyJ….sig`) no longer redacts.

Every real-world carrier of a JWT is delimited, and all were verified
byte-identical under the fix: `Authorization: Bearer eyJ…`, JSON
`{"id_token":"eyJ…"}`, URL `?id_token=eyJ…&`, `JWT=eyJ…` env lines,
`Cookie: sess=eyJ…;`, after a newline, and at start-of-string. A run of
base64url characters with a JWT concatenated onto it carries no token
boundary — nothing would parse it as a token either.

This is recorded as a decision, not left to be discovered: §6.3 asserts
the non-match explicitly, so a future reader sees an intended boundary
rather than a gap.

## 6. Testing

1. **Equivalence corpus.** The 14-case corpus used to validate this
   design becomes a test: 13 assert byte-identical output between the old
   and new patterns (both compiled in the test), covering minimal HS256,
   typical RS256, RS512 with a large signature, an 8 KB-payload ID token,
   a 16 KB payload, a 3 KB x5c header, and each delimiter form.
2. **Timing regression.** The detector is timed against
   `'eyJaA0'.repeat(n)` at 39 / 156 / 313 KiB with a generous wall-clock
   ceiling (the fixed pattern measures 0.06 / 0.23 / 0.43 ms; a ceiling
   around 50 ms leaves three orders of magnitude of headroom while still
   failing loudly if the quadratic returns). The test also asserts the
   fix's own worst case — delimiter-separated starts at 313 KiB.
3. **Glued non-match.** An explicit assertion that the glued form does
   not redact, with a comment naming it as the accepted trade-off from
   §5 so nobody "fixes" it back into a quadratic.
4. **Existing suites unmodified.** `redact.test.ts` (which carries a JWT
   positive), `redact-pii.test.ts`, `redact-unstructured.test.ts`, and
   `redact.property.test.ts` all pass untouched.
5. **Ordering unchanged.** `jwt` keeps its index; a test asserts the
   relative order of the baseline is unchanged.

## 7. Consumers

No signature changes. `redact`, `redactWithFindings`, and
`redactForLedger` are untouched; `RedactResult` is unchanged; the finding
name stays `jwt`. Nothing downstream needs an edit.

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

## 9. Process

CRITICAL chain: this spec → architect pass → `security-reviewer` design
pass → `writing-plans` → worktree → TDD → `pnpm verify` + reproduction
evidence → `code-reviewer` AND `critic` (separate passes, author ≠
reviewer) → `omc:tracer` evidence loop → verifier. Changeset for
`@megasaver/policy` (patch — a bug fix with no API change). Wiki: update
`entities/policy` and append to `log.md`, including the corrected
severity classification so the record does not carry the original
overstatement.
