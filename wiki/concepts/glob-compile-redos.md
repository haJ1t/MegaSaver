---
title: Glob-compile ReDoS (regex built from untrusted input)
tags: [concept, redos, regex, glob, policy, security]
sources:
  - packages/policy/src/glob-matcher.ts
  - packages/policy/src/secret-paths.ts
  - docs/superpowers/specs/2026-07-25-glob-compile-redos-fix-design.md
status: active
created: 2026-07-25
updated: 2026-07-25
---

# Glob-compile ReDoS

A **distinct shape** from [[concepts/unbounded-run-redos]]. That page describes
an unbounded greedy run followed by a required literal, in a regex *we wrote*,
applied to untrusted *text*. This one is the inverse: the regex itself is
**built from untrusted input**.

## The shape

> A pattern language is implemented by string-concatenating user input into a
> regex. The translation is ambiguous, and the characters that are not part of
> the pattern language reach the engine unescaped.

Two failure modes fall out, and they need separate fixes:

1. **Ambiguous quantifier chaining** — adjacent unbounded quantifiers admit
   many splits of the same subject, so a non-matching subject walks all of them.
   Exponential, not quadratic.
2. **Metacharacter injection** — the untrusted string is a partially-interpreted
   regex, so the attacker does not need the pattern language's own wildcards at
   all.

## Instance: `compileGlob`, `packages/policy` (fixed 2026-07-25)

Measured against a 255-character subject, `k` = wildcard count:

| k | `*a`×k | `**a`×k | `**/a`×k |
|---|---|---|---|
| 3 | 17 ms | 14 ms | 3.6 ms |
| 4 | 1,041 ms | 1,027 ms | 126 ms |
| 5 | 58,530 ms | 47,486 ms | 3,234 ms |
| 6 | — | — | 158,483 ms |

Zero-wildcard injection: `(a+)+b` cost 1,130 ms on 28 characters. End to end,
`evaluatePathRead` burned ~6 s and returned `allowed: true`; `rankApplicableRules`
cost 70 s for one rule.

Third, quieter failure: `**/a+b.txt` did **not** match `x/a+b.txt`. A deny rule
that silently does not deny, reachable with an ordinary filename.

## Why the obvious mitigations fail

All three were measured, not argued:

- **Collapsing consecutive `(?:.*/)?` groups** — does not apply; the vector has
  a literal between the groups.
- **Rewriting `**/` as `(?:[^/]*/)*`** — *slower* than what it replaces
  (344 ms vs 126 ms at k=4) despite being language-equivalent over 18 cases.
- **Capping wildcard count at the parse boundary** — must be ≤2 to hold, which
  rejects the shipped `**/*.pem`; and failure mode 2 bypasses it with zero
  wildcards. A cap counts a token the exploit does not need.

## The fix

Delete the regex. Tokenize once, match by NFA simulation over a boolean
reachability frontier advanced once per token. No backtracking exists by
construction, so there is no bound to tune and no cap to bypass. Every character
outside the pattern language is a literal, which closes injection and the silent
mis-match together.

`compileGlob` returns `PathMatcher` (`{ test(path): boolean }`), not `RegExp`.

## Lesson

A cap is only sound if it bounds the axis the exploit actually uses. Here the
reported axis (`**/` count) was neither the only wildcard that blew up nor
necessary at all. Prefer removing the backtracking engine over bounding its
input.

The equivalence obligation is the real cost of this fix: the LOCKED §9a denylist
must keep its exact verdicts, so the pre-fix implementation is frozen verbatim
as a test oracle. Generators for that property must be checked for
**non-vacuity** — the first version scored 0/20,000 matches against the denylist
globs and could only ever have compared `false === false`.

## Related

- [[concepts/unbounded-run-redos]] — the *other* regex defect class in this repo.
- [[entities/policy]] — where this lives.
