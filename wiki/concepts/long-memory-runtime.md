---
title: Evidence-Backed Long Memory Runtime
tags: [concept, memory, benchmark, evidence, long-memory]
sources:
  - sources/longmemeval-v2.md
  - concepts/structured-memory-engine.md
  - concepts/memory-superset.md
  - docs/superpowers/specs/2026-07-19-long-memory-runtime-design.md
  - docs/superpowers/specs/2026-07-20-long-memory-lm1-observations-design.md
  - docs/superpowers/plans/2026-07-20-long-memory-lm1-observations-plan.md
  - docs/superpowers/specs/2026-07-20-long-memory-lm2-hybrid-recall-design.md
  - docs/superpowers/plans/2026-07-20-long-memory-lm2-hybrid-recall-plan.md
  - docs/superpowers/specs/2026-07-20-long-memory-lm2-quota-ledger-amendment-design.md
  - docs/superpowers/plans/2026-07-20-long-memory-lm2-quota-ledger-rework-plan.md
  - docs/superpowers/specs/2026-07-20-long-memory-lm2-runtime-security-completion-design.md
  - docs/superpowers/plans/2026-07-20-long-memory-lm2-runtime-security-completion-plan.md
  - commit 065df3e6 (LM2 ledger invariants)
  - commit 20853aac (LM2 fenced recovery receipts)
  - commit 65de9013 (LM2 bounded semantic deadlines)
  - commit 21af7f37 (LM2 bounded approval waits)
status: LM0 and LM1 verified; LM2 runtime and benchmark hardening implemented; final whole-branch review and official LongMemEval-V2 score pending
created: 2026-07-19
updated: 2026-07-20
---

## Decision

One agent-neutral, evidence-backed runtime serves product recall and
LongMemEval-V2; it is not a benchmark-only memory system. (source:
[[sources/longmemeval-v2]])

## Model

The runtime adds redacted snapshots and transitions to approved engineering
memory. Suggested runbooks, gotchas, and premises require evidence and human
approval before agent injection. (source:
`docs/superpowers/specs/2026-07-19-long-memory-runtime-design.md`)

## Delivery

LM0 benchmark contracts → LM1 observations → LM2 hybrid recall → LM3 approved
knowledge/media. Hot Handoff remains separately owned. (source:
`docs/superpowers/specs/2026-07-19-long-memory-runtime-design.md`)

LM0 now has an isolated `@megasaver/long-memory` package, deterministic
workspace-scoped observation deduplication, receipt-bearing BM25 recall, a
JSONL host, and a public-data-only LongMemEval-V2 adapter. It does not change
existing product memory or imply LM1–LM3 capabilities. (source:
`docs/superpowers/specs/2026-07-19-long-memory-runtime-design.md`)

LM1 now implements durable, immutable snapshots/transitions with evidence-bound
capture, retry-stable evidence adoption, revocation-aware correction recall, and
a private file store composed only through the evidence-gated `createLm1Runtime`
surface. It preserves LM0's TypeScript and JSONL boundaries. Every record has a
durable exact-ID locator, so transition and correction endpoint checks read one
validated locator and raw record rather than scanning an unbounded corpus.
Recall streams bounded raw/pointer/coverage/closure worksets and omits an
incomplete correction group rather than surfacing stale state. (source:
`docs/superpowers/specs/2026-07-20-long-memory-lm1-observations-design.md`)

Release evidence: the long-memory package passed 106 tests, package build, and
the full `pnpm verify` gate; the LongMemEval-V2 adapter suite passed 7/7. Fresh
independent code and adversarial reviews approved the final locator-backed
implementation. This is not an official LongMemEval-V2 harness score; LM1 is
text-only with multimodal and hybrid retrieval deferred to later increments.
(source: `docs/superpowers/plans/2026-07-20-long-memory-lm1-observations-plan.md`)

LM2's reviewed design adds an explicit hybrid Safe/Adaptive retrieval boundary.
Safe delegates exactly to LM1. Adaptive adds optional semantic RRF only through
configured, approved embedding ports, bounded pre-materialized vector sidecars,
and LM1's existing correction/evidence selector. It does not claim whole-LM1
semantic coverage: Adaptive ranks only the bounded catalog of records captured
through the explicit LM2 runtime, while legacy records stay available through
Safe. Remote embedding requires a current workspace/model approval, and
revocation after dispatch prevents persistence but cannot retract already-sent
input. LongMemEval-V2 remains an evidence gate: official web/enterprise runs
plus a leaderboard `submission_overview.json` are required before any LAFS
claim. Independent architecture and adversarial reviews approved the design;
implementation must follow its dedicated TDD plan and release gates. (source:
`docs/superpowers/specs/2026-07-20-long-memory-lm2-hybrid-recall-design.md`)

Task 4 review found that a directory-wide sidecar quota scan could violate the
same index call's 1,024 sidecar-metadata-read cap. The accepted rework replaces
that path with one canonical, at-most-64-KiB workspace allocation ledger under
one fixed-inode, token-bound operation lock. `embeddings-v2` sidecars carry the
ledger epoch and a contiguous allocation sequence; exact namespace counts and
serialized-byte totals replace per-sidecar quota recomputation. The indexer
acquires the operation before catalog work, keeps it through every batch and
final ledger commit, and returns discriminated complete/continue/retry/expired
receipts with explicit recovery state. Pending recovery reads only its at-most
16 named targets, never enumerates an embeddings namespace, and read-only
Adaptive access excludes every sidecar above the committed watermark. (source:
`docs/superpowers/specs/2026-07-20-long-memory-lm2-quota-ledger-amendment-design.md`,
`docs/superpowers/plans/2026-07-20-long-memory-lm2-quota-ledger-rework-plan.md`,
commits `065df3e6`, `20853aac`, `65de9013`, `21af7f37`)

The quota and contiguous-publication guarantees apply to compliant,
ledger-aware writers serialized by that lock. A well-formed trusted-root
ledger rollback performed wholly outside an operation cannot be detected in
Node's static-symlink model because no native anti-rollback anchor exists.
During an operation, descriptor/path, inode, token, generation, operation-id,
deadline, and evidence checks still fail closed; the external rollback case is
an explicit threat-model limitation, not a recovery claim. (source:
`docs/superpowers/specs/2026-07-20-long-memory-lm2-quota-ledger-amendment-design.md`,
commits `20853aac`, `21af7f37`)

The LM2 candidate catalog now has separate V2 schema/cursor, anchored storage,
and fixed-inode lock modules. Its immutable control record binds the permanent
lock device, inode, and random token; each acquisition, mutation, and release
rechecks that binding. The only automatic crash recovery states are an orphan
lock before control/catalog publication and a valid control record before the
canonical empty catalog. Either V1 pathname is explicitly unsupported and is
left byte-identical. Process-level regressions cover idle and held lock-path
replacement with actual API writers, V1 admission after lock acquisition,
catalog symlinks, descriptor-close failure, both named crash cuts, and
concurrent appenders. V1 absence is fenced immediately after the OS flock and
before bootstrap token publication, then again at each mutation/publication
callback and release. The deterministic bootstrap regression requires the V2
lock to remain empty and the control/catalog paths absent when V1 arrives in
that interval. Catalog coverage is split into focused files, and every Task 3
source, test, and fixture remains below 300 lines. Independent Task 3 re-review
remains pending.
(source:
`docs/superpowers/specs/2026-07-20-long-memory-lm2-runtime-security-completion-design.md`,
`.superpowers/sdd/task-3-report.md`)

The Task 5 LongMemEval-V2 integration is a separate, non-root-exported
transport with a pinned official-checkout installer and Python `Memory`
backend. Python admission validates pinned manifest identities, row/digest
bindings, timestamp grammar, nonempty question IDs, and exact local model
limits before transport. Normal package builds also emit the private canonical
and manifest entrypoints consumed by the non-contract builder, without adding
package-root exports or bins. TypeScript and Python recompute every projection
UUIDv5 from the exact `trajectoryId + NUL + sourceKind + NUL + sourceIndex`
frame, with a shared fixed vector and zero-transport substitution regression.
Projection text is NFC/trim canonicalized after its surrogate-safe 50,000-unit
cut, closing the released `096432bf` `states[12]` whitespace boundary while
preserving its UUID and final-text digest. The pinned enterprise/Small corpus
builder passed unmodified screenshot validation and emitted later trajectories.
Rejected queries launch no transport and write only
redacted telemetry through a private random root whose cache-parent, directory,
and file identities are descriptor-anchored; raw question/context fields are
omitted. Save-state load acquires the run flock and revalidates its locked
descriptor, pathname, run root, and identity-bound controls before adoption.
Busy, FIFO, link, and replacement substitution fail closed. This is
implementation evidence only, not an official LongMemEval-V2 score. (source:
`.superpowers/sdd/task-5-report.md`)
