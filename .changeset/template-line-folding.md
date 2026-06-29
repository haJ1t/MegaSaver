---
"@megasaver/output-filter": minor
---

feat(output-filter): template-line folding (collapseSimilar)

Add a second normalize pass that runs after `collapseRepeatedLines`. It
masks pure identity-noise tokens (ISO/clock timestamps, uuid/hex ids,
request-id ports) to placeholders, then folds a run of consecutive lines
whose MASKED form is identical into one exemplar + a counted marker
`… [N similar: <masked template>]` (N is the run length), keeping the
FIRST and LAST concrete instance verbatim as boundary evidence. This
catches build/install/server log spam — lines identical except a
timestamp/id — that `collapseRepeatedLines` misses because the lines are
not byte-identical.

Tool-resident: runs in both the CLI saver hook and the MCP read/run tools.
Folding only changes what is RETURNED.

Evidence-preserving (risk HIGH): masking is deliberately narrow. Duration,
byte-count, and decimal-number masks are intentionally NOT applied — those
values are often the distinguishing signal (a 9000ms slow request, a
4096 B write, a distinct account id), and the return path is the only copy
that reaches the agent, so masking them would be non-recoverable evidence
loss. The hex mask requires at least one hex letter so pure-decimal ids are
never merged. A line carrying any diagnostic signal (error/fail/exception/
warning/panic/fatal keyword, a `TS####` code, or a `file:line:col`
position) is never folded.
