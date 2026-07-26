---
title: "ReDoS cases: policy redaction patterns (instances 4, 5, 10)"
tags: [concept, redos, case-study, policy, regex]
sources: [packages/policy/src/redaction-patterns.ts, packages/policy/src/redact.ts, packages/policy/test/redact-redos.test.ts, docs/superpowers/specs/2026-07-25-policy-redaction-redos-design.md]
status: active
created: 2026-07-26
updated: 2026-07-26
---

# ReDoS cases in `@megasaver/policy`

Case studies for [[concepts/unbounded-run-redos]]. Instance 1 (`jwt`) is written
up on [[entities/policy]]. Instances 4 and 5 were closed by one spec,
[[docs/superpowers/specs/2026-07-25-policy-redaction-redos-design]], with one
bound each; guard `packages/policy/test/redact-redos.test.ts`. Instance 10
replaced three of those bounds with a [[concepts/lookahead-start-guard]] and is
written up there.

## Instance 5: the lookbehind variant

**V8 evaluates a lookbehind right to left.** That is the whole mechanism, and it
is why these three read as safe: the `\s*` that rescans is the one written
*last*, nearest the value, not the one nearest the key literal. At every start
position it consumes the whole preceding whitespace run, requires the delimiter,
fails, and gives back one character at a time.

| pattern | bound added | 50 KB | 100 KB |
|---------|-------------|-------|--------|
| `aws_secret_key` | trailing `\s*` → `\s{0,64}` | 2,206 ms | 9,412 ms |
| `basic_auth_header` | `basic\s+` → `basic\s{1,64}` | 1,894 ms | 8,350 ms |
| `api_key_header` | trailing `\s*` → `\s{0,64}` | 1,280 ms | 7,606 ms |

The **leading** `\s*` in each was deliberately left alone. Reaching it needs the
delimiter within 64 characters behind, and one delimiter per ≤64 characters is
exactly what caps the leading run — the two conditions are mutually exclusive, so
it is O(n) already. Bounding it too measures identical (10–140 ms at 200 KB
across `ws=ws`, `ws:ws`, `(ws×500)basic(ws×500)` and `(ws×64)=`). **A bound that
is not load-bearing is a change no red test can justify.**

## Instance 4: `email`, and why the size gate was the wrong fix

The registry page previously recorded "a size gate on the observer loop may be a
cheaper correct fix than touching the locked pattern," and separately claimed
`email` "never modifies text." Reading the sink says otherwise —
**`OBSERVED_PATTERNS` is not count-only everywhere.** `redactForLedger`
(`redact.ts:53-59`) runs the same array and actually *replaces*, because an email
must never persist into a ledger `sourcePath` label (F-FW-1). A gate in
`redactWithFindings` leaves that second loop quadratic; a gate in both turns a
DoS into an email leak above the cap. The gate also zeroes the `observed` count
on exactly the large diffs the observer exists for.

Bounding the local part to `{1,64}` (RFC 5321 §4.5.3.1.1) fixes both loops at the
root: 6,049 → 23,098 ms at 50 → 100 KB of letters, now linear. The bound is still
greedy **with backtracking**, so an over-long local part does not stop matching —
the match starts later, at the same `@` — and the reported count is unchanged.
The domain run needs no bound: its start positions are the `@`s and each run it
opens is terminated by the next `@`, so the total is already O(n).

**Rule this adds:** before gating a loop to dodge a locked literal, grep for the
other callers of the array. "Count-only" was a property of one call site, not of
the data.

## On the LOCKED table

`aws_secret_key` is row 5 of the §5a baseline
(`docs/superpowers/specs/2026-05-10-bb3-policy-design.md`). `api_key_header`,
`basic_auth_header` and `email` are **not** in it. The lock is documentary — no
snapshot test pins pattern bytes — and its amendment procedure was set by the two
`jwt` amendments of 2026-07-20, both for this same defect class: add a dated
footnote, never rewrite the row. Followed here.

## Related

- [[concepts/unbounded-run-redos]] — the registry.
- [[concepts/lookahead-start-guard]] — instance 10, which superseded three of the
  bounds above.
- [[concepts/redos-growth-ratio-measurement]] — why one whitespace shape does not
  separate every bound in this set.
- [[entities/policy]] — instance 1 (`jwt`).
