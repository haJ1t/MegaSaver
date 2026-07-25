---
"@megasaver/policy": minor
---

Match path globs with a linear NFA instead of a compiled regex.

`compileGlob` built a `RegExp` from untrusted glob text. The wildcard
translations were ambiguous, so chained wildcards backtracked exponentially —
and not only in the `**/` form first reported: `*a`x5 against a 255-character
path measured 58,529 ms. Separately, every character other than `*`, `?` and `.`
was emitted into the regex body unescaped, so a glob was a partially-interpreted
regex: the zero-wildcard `(a+)+b` is itself a ReDoS at 1,130 ms on 28
characters, and an ordinary deny rule `**/a+b.txt` silently failed to match
`x/a+b.txt`.

End to end, a `.megasaver/permissions.yaml` carrying a crafted `deny.read` glob
drove `evaluatePathRead` to burn ~6 s and then return `allowed: true`. The same
matcher backs `ProjectRule.appliesTo` ranking in `@megasaver/core`, where a
single hostile rule cost 70 s.

Matching is now an NFA simulation over a boolean reachability frontier advanced
once per token, so no backtracking exists by construction — O(tokens x path
length). Every character that is not `*`, `**`, `**/` or `?` is matched
literally.

Linear is not the same as bounded, so glob length, glob count and command count
are each capped at 256 in `.megasaver/permissions.yaml`; exceeding a cap is a
`PolicyLoadError`, never a silent trim. Bracket expressions (`[abc]`) are
**rejected** rather than reinterpreted: they are genuine glob syntax that the
regex honoured, so silently reading them as literal characters would narrow the
deny set with no operator signal.

**Security fix, previously unclaimed:** the old `**/` translation `(?:.*/)?`
relied on `.`, which in a non-`s`-flag JS regex does not match a line
terminator. Any path carrying `\n`, `\r`, U+2028 or U+2029 in a directory
segment therefore bypassed 13 of the 15 baseline secret-path entries — all
legal POSIX filename bytes. The NFA matcher has no such carve-out, and the
bypass now has regression tests.

**API change:** `compileGlob` returns `PathMatcher` (`{ test(path): boolean }`)
rather than `RegExp`, and `PathMatcher` is newly exported.
`ProjectPermissions.denyReadPatterns` / `denyWritePatterns` are retyped to
match. All in-repo call sites used only `.test()` and are unaffected.

Verdicts for the LOCKED §9a denylist are unchanged, pinned by a frozen fixture
table plus 60,000 randomized comparisons against the previous implementation,
with generators chosen for measured non-vacuity.
