---
risk: HIGH
status: implemented
source: pre-merge review follow-up, PR #293 (Hot Handoff)
---

# Handoff redaction guard — design

## Problem

`buildHandoffPacket` (`packages/core/src/handoff-export.ts`) redacts each
free-text payload field by hand: `taskSummary.text`, `resumeInstructions`,
`commits[].subject`, `diff.text`, and every field reached by `redactFailure`
/ `redactMemory`. There is no single choke point.

Two findings from the PR #293 review:

1. **No structural guard.** A string field added to `handoffPayloadSchema`
   later ships **unredacted by default**. The failure mode is silent and only
   surfaces in a packet the user may copy to another machine. Two real
   backstops exist today — `apps/cli/src/commands/handoff/open.ts:95-98`
   re-redacts before writing agent config, and `applyHandoffMemories:56-57`
   re-redacts content+title before the registry write — so this is hardening,
   not a live leak. But the packet itself is the artifact that travels, so it
   must be clean at the source.
2. **`git.branch` is unredacted.** The one free-text payload field not passed
   through the redactor. Low severity (branch names rarely carry secrets; the
   open side re-redacts the rendered git line) but inconsistent with every
   sibling field.

## Decisions

**Guard shape: test-based, not a runtime walk.** A schema-driven walk that
redacts every string at pack time was considered and rejected. Redaction is
not free of side effects on structural values: uuids, ISO timestamps, git
shas, and file paths would all be fed to `redactWithFindings`, and any
incidental pattern match would corrupt a field the reader must parse. It
would also inflate `redactionFindings` by double-passing fields the per-field
code already redacted. The review explicitly permits the cheaper test-based
guard; it is the correct one here.

**Guard content.** A zod walker enumerates every `ZodString` leaf path in
`handoffPayloadSchema` and asserts the set equals `REDACTED_PATHS ∪
STRUCTURAL_PATHS` — two literal lists in the test. Adding any string field to
the schema fails CI until the author classifies it. Enums are absent by
construction (the walker only descends to `ZodString`); a closed value set
cannot carry a secret.

**Fail closed.** The walker throws on any zod wrapper it does not recognize.
Returning `[]` for an unknown shape would make the guard decorative: a
`z.record(z.string())` or `z.union` field would contribute no path, the
classification set would still match, and the field would ship unredacted —
the exact failure this guard exists to catch. `ZodNumber` / `ZodBoolean` /
`ZodEnum` are named explicitly as non-string leaves.

**Behavioral companion, derived not restated.** One test plants the same
secret into every `REDACTED_PATHS` entry and then, per path, resolves the
built payload and asserts the values are **both non-empty and secret-free**.
The non-empty half is what upgrades the classification from documentation to
enforcement: a blanket "the JSON contains no secret" passes vacuously for a
field the fixture forgot to populate, so a new path could be classified and
never actually wired through `r.text()`.

**Four lists.** `REDACTED` (scrubbed in place), `STRUCTURAL` (machine-shaped,
asserted by regex rather than by classification alone — appending a leaky path
here is exactly the mistake the first draft made), `DROPPED` (anchor keys, see
below), and `UNREACHABLE`.

**Unreachable.** `failures[].resolution` is redacted by
`redactFailure` but can never reach a packet (`selectFailures` admits only
`resolution === undefined`). It gets its own `UNREACHABLE_PATHS` list with a
test asserting it stays unreachable, rather than sitting on the redacted list
where the non-empty assertion would fail.

## Scope grew during review

The first pass classified `git.changedFiles[].path`,
`git.diff.excludedPaths[]`, and the three anchor path/name fields as
STRUCTURAL on the reasoning that paths are "already gated by
`evaluatePathRead`". That reasoning is wrong: the gate decides *whether* a
path travels, it never rewrites what the path spells out. Adversarial review
demonstrated all five shipping a raw secret in a real packet — and the guard,
as first written, certified them as safe. All five are now redacted.

**Anchors are dropped, not redacted.** A second adversarial pass showed that
redacting an anchor path *in place* is the one option that is neither safe nor
functional. `code-truth` uses `files[].path` as the `git cat-file HEAD:<path>`
lookup key and matches candidates by `symbols[].name`; a rewritten value
resolves to nothing, so `mega memory verify` on the receiving side reports a
false `contradicted`, sets `stale = true`, closes `validTo`, and writes an
evidence line naming a file that does not exist. The receiver cannot tell a
redaction artifact from a real deletion.

So `redactMemory` drops the whole anchor — and `lastVerified` with it, since a
verification stamp for an absent anchor renders a badge nothing can re-check —
whenever redaction would alter any anchor path or symbol name. The memory
imports unanchored, which is precisely what it is once its lookup keys cannot
travel. A clean anchor passes through byte-identical, hashes included.

This lives in `redactMemory` (`brain-export.ts`), the shared choke point, so
`mega brain export` gets the same behavior.

## Non-goals

- Changing `redactionFindings` semantics (still advisory high-water; a secret
  in a branch name is now counted twice, once via the brief and once via
  `git.branch`).
- Redacting `report.excludedPaths` — the report never leaves the sender's
  machine, and the raw paths are what the operator needs to see.
- `manifest.sourceProject.name`, which is unredacted and outside the payload
  guard's reach. Flagged, not fixed: it is a local directory name, not agent
  prose, and the manifest is a separate surface.
- Touching the two downstream re-redaction backstops.
- Any change to the packet schema or wire format.
