---
"@megasaver/cli": patch
---

Three saver-hook repairs from the 2026-07-31 audit. (1) Foreground Bash's
eligibility floor was `budget + 1` — 32 001 under safe mode, above Claude
Code's ~30 000-char truncation ceiling, so single-stream Bash output could
never compress in safe mode; it now gates at
`min(budget, BASH_COMPRESS_FLOOR)` (24 000 / 12 000 / 4 000), matching the
BashOutput/Monitor branch. (2) The Grep/Glob filenames rebuild delivered a
silently shortened path list; it now appends a counted
`… [Mega Saver: N of M paths omitted]` marker plus the summary and recovery
footer as `… `-sentinel trailing entries, and `numFiles` reports the
delivered genuine-path count. (3) Dual-stream Bash output no longer joins
streams around an in-band boundary line that ranking could drop; each stream
is recorded separately and re-attached to its slot structurally, so stderr
evidence can no longer be mislabeled or lost under budget pressure.
