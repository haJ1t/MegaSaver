---
title: Testing for the unbounded-run ReDoS class
tags: [concept, redos, testing, regex, mutation-testing]
sources:
  - packages/policy/test/redact-superlinear.test.ts
  - scripts/redos-probe.mjs
status: active
created: 2026-07-25
updated: 2026-07-25
---

# Testing for the unbounded-run ReDoS class

How to fence a fix for [[concepts/unbounded-run-redos]] so the next edit cannot
quietly undo it. Every rule here was paid for by a suite that passed while broken.

## Pick the instrument by measured separation

**A timing ceiling only guards what it separates.** The first fix's suite ran at
50 KB with a 5 s ceiling — four of five reverted patterns cost 2.9–4.7 s and
stayed green. Raising the input size is the cheap separator: at 100 KB the
cheapest of those reversions costs 12.2 s. Size the guard at the **shipped cap**
where one exists, not at an arbitrary probe size.

Where that still fails, use a **growth ratio** — run at n and kn, fail above a
threshold set by the measured separation. Runtime-independent, nothing to
calibrate. `private_key_block` needs it: bounded, it costs *more* than unbounded
below ~256 KB, so a ceiling would flag the fix rather than the defect. Building
one correctly is its own subject: [[concepts/redos-growth-ratio-measurement]].

**Neither instrument alone is safe.** A ratio-only suite passes a broken
`aws_secret_key`, which flattens toward x1.4 once it is slow enough to hit
thermal limits. Ratios also need a duration floor: below ~5 ms they measure the
scheduler. And never assert a *lower* bound on runtime — it fails when the code
gets faster.

## A pattern-agnostic corpus is vacuous

A proposed table-wide structural guard was tested and would not have caught the
known instances (5 of 6 were module-level consts outside both pattern tables;
against a 46-shape generic corpus it misses `jwt` entirely, because the corpus
never manufactures a start position).

The same failure recurred on 2026-07-25: the first differential fuzz used random
strings and reported `matched=0` for **six of seven** patterns — random text
never produces `aws_secret_access_key=` or `-----BEGIN … PRIVATE KEY-----`. Zero
divergences, meaning nothing. Reseeded so every input carries a real anchor, it
matched 23,000–50,000 of 50,000 and immediately found that the proposed `db_url`
bound loses a JWT-used-as-password.

**Rule: assert a minimum match count before asserting anything about what a
corpus produced.**

## Commit the harness

A cited divergence count with no committed harness is unfalsifiable. Three counts
from this work needed correcting and one had to be **withdrawn** because no
committed script could reproduce it. `scripts/redos-probe.mjs` now regenerates
every figure quoted in the spec, the changeset and the source comments.

## Test the pipeline, not only the regexes

A suite of 259 tests that all asserted on regexes in isolation left
`packages/policy/src/redact.ts` completely unfenced: inserting
`if (text.length > 200_000) return …` into `redactWithFindings` passed
**everything**, sending every secret in a capture over 200 KB to the agent in
cleartext. Pattern-level isolation is right for equivalence (through the real
pipeline an earlier detector often eats the token first), but at least one
assertion must go through the public entry point.

Timing assertions in particular must drive each pattern through **its own real
call site**, never the bare regex — a sibling fix was weakened exactly that way.
And verify each bound goes red **alone**, with the others left in place.

## A fixture can mask the bound it tests

The first `db_url` password-bound fixture used a JWS (`eyJ…`), which the `jwt`
detector redacts regardless — so it proved nothing, and a 2048 bound shipped that
left real ~2.5 KB opaque tokens (JWE, AWS RDS IAM auth tokens) in cleartext. When
testing detector N's bound, the payload must be invisible to detectors 1..N-1.

## Mutate, then count survivors

29 of 29 mutants against the pattern table were killed; four survivors turned up
one layer out — the size gate above, and three on patterns whose bytes were not
pinned (whitespace before a separator, a `+`-bearing URL scheme, an 8-character
credential). Character-coverage blindness is the recurring cause: the corpus
never contained the shape the mutant broke.
