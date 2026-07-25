---
title: First-character lookahead guard (ReDoS fix tool)
tags: [concept, redos, performance, regex, policy]
sources:
  - packages/policy/src/redaction-patterns.ts
  - docs/superpowers/specs/2026-07-25-redaction-superlinear-patterns-design.md
status: active
created: 2026-07-25
updated: 2026-07-25
---

# First-character lookahead guard

The third tool for [[concepts/unbounded-run-redos]], alongside bounding a run and
adding a left-boundary lookbehind. It applies to one specific cost: a
**variable-length lookbehind re-walked at every offset**.

## The move

Place a lookahead *before* the lookbehind, with a class equal to exactly the set
of first characters the pattern body can match. It rejects a non-matching start
position in O(1), so the expensive lookbehind never runs there.

```
/(?=[A-Za-z0-9/+])(?<=aws_secret_access_key\s*=\s*)[A-Za-z0-9/+]{40}/g
```

At 100 KB of whitespace, unguarded → guarded
(`node scripts/redos-probe.mjs timing`): `aws_secret_key` 9,711 → **0.16** ms;
`api_key_header` 5,309 → **0.15**; `basic_auth_header` 4,121 → **0.18**. Orders
of magnitude better than bounding the same runs.

## Why it is preferable to a bound here

**Equivalence is provable, not empirical.** An assertion implied by the rest of
the pattern cannot drop a match, so the guard needs no coverage statement and no
disclosed loss — unlike every bound. Independently verified over 986,880
exhaustive first-character cases and 900,000 seeded trials, 0 divergences.

Deriving the class is the whole job. For `api_key_header` the body is
`(?:"[^"]*"|'[^']*'|[^\s"']{8,})`, whose first characters are
`{"} ∪ {'} ∪ [^\s"']` = exactly `\S`. Get this wrong in the narrow direction and
the guard silently drops secrets.

## Two hazards

**It must stay in FRONT of the lookbehind.** Moving it after gives
byte-identical output and restores the full quadratic. Mutation-tested: 41 of 43
assertions stayed green: only a structural assertion on the guard's *position*
(`source.startsWith(...)`) and the timing test caught it. Pin the position.

**It relies on V8 evaluating assertions left to right** — an engine property, not
an ECMAScript guarantee. Correctness is unaffected either way, since the guard is
semantically inert; only the speedup is at risk. A timing test with wide margin
is the mitigation (measured ~200x).

## When NOT to reach for it

Only when the driver is a lookbehind. For an unbounded *forward* run followed by
a required literal, bound the run. And the choice is per pattern, by measurement:
`jwt` wanted a left-boundary lookbehind and bounding was wrong (real segments
reach 16 KB); the output-filter signal regexes wanted bounding and a lookbehind
lost real matches. A symmetric guard for `email` was measured **lossy** and
rejected.
