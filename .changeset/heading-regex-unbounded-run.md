---
"@megasaver/indexer": patch
---

Stop the markdown heading regex from backtracking on a line it cannot match.

`HEADING_RE` paired `\s+` with a `(.+?)` capture. Both can match a space, so a
heading-shaped line that ultimately fails made the engine try every
(whitespace-run x capture) split before giving up. Measured through `extractMd`
on `"#" + " "*W + "x"*W + "\r y"`, doubling W: the lazy form was **cubic**
(1.2 s / 8.4 s / 67 s at W=2k/4k/8k) and an intermediate `\s+(.+)\r?$` form was
still **quadratic** (1,575 ms at W=32k). This is on every `.md` file walked by
`mega scan` / `mega index`, whose 1,000,000-byte cap left ample room.

The pattern is now `/^(#{1,6})\s/` — `#{1,6}` is bounded and `\s` matches exactly
one character, so there is no unbounded quantifier and no backtracking is
possible. The name is taken by slicing and `trim()` rather than by a second
quantifier. Same input now costs **0.02 ms at W=32k**.

Two behavioural notes. Interior `\r`/U+2028/U+2029 was rejected before only as a
side effect of `.` excluding line terminators; slicing has no such side effect, so
the rejection is now explicit. And a hash line that is only whitespace (`"#  "`)
is no longer a heading: the old regex accepted it with the name `" "` purely
because `\s+` had to surrender one character, while already rejecting `"# "`.
One rule — a heading needs a non-whitespace name — replaces a rule plus an
exception. The change is one-way and can only drop a nameless heading, never
invent one.
