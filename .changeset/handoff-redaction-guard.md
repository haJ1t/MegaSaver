---
"@megasaver/core": patch
---

Redact three free-text handoff payload fields that shipped verbatim:
`git.branch`, `git.changedFiles[].path`, and `git.diff.excludedPaths[]`. Every
sibling field (commit subjects, diff text, memory and failure fields) was
already redacted; a secret in a file name was redacted in
`memories[].relatedFiles` and then shipped intact in
`memories[].anchor.files[].path` two fields later. `excludedPaths` is by
construction the list of files that matched a secret deny-glob.

Code anchors are handled differently: `redactMemory` now DROPS the whole
anchor (and `lastVerified` with it) when redaction would alter any anchor path
or symbol name, instead of rewriting them. Those fields are code-truth lookup
keys — `git cat-file HEAD:<path>` and symbol-name matching — so a redacted
value resolves to nothing and makes the receiver record a false
`contradicted`, closing the memory's `validTo`. The memory now imports
unanchored instead. A clean anchor passes through byte-identical, hashes
included. This lives in `redactMemory`, so `mega brain export` behaves the
same way.

Adds a structural guard against the underlying failure mode: handoff
redaction is per-field discipline with no choke point, so a string field
added to `handoffPayloadSchema` later would ship unredacted by default and
silently. Three tests now enumerate every string leaf in the schema (failing
closed on any zod wrapper the walker does not recognize), require each leaf
to be classified as redacted / structural / dropped / unreachable, and plant
one secret
into every redacted path at once, asserting each is both populated and clean.

Behavior notes: `report.excludedPaths` stays raw; it never leaves the
sender's machine. A secret in a branch name now
increments `redactionFindings` twice (once in the brief, once in
`git.branch`); that counter is already documented as advisory high-water.
