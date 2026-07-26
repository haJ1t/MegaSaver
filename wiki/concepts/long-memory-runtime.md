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
  - benchmarks/longmemeval-v2/evidence-schema.json
  - benchmarks/longmemeval-v2/verify-official-artifacts.mjs
  - packages/long-memory/test/lm2-completion-integration.test.ts
  - commit 065df3e6 (LM2 ledger invariants)
  - commit 20853aac (LM2 fenced recovery receipts)
  - commit 65de9013 (LM2 bounded semantic deadlines)
  - commit 21af7f37 (LM2 bounded approval waits)
status: LM0 and LM1 verified; LM2 implementation and local completion gate verified; final whole-branch review and official LongMemEval-V2 score pending
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

The product now reuses LM2 ranking through the read-only
`@megasaver/memory-recall` adapter. It maps only Core-filtered `MemoryEntry`
records into `memory_entry` candidates and accepts a vector only when the
existing Core hash manifest matches that entry's current title/content. A
missing, corrupt, or stale vector set stays Safe/lexical; a partial current
set uses Adaptive with every eligible lexical candidate retained. The adapter
does not create a competing memory lifecycle. (source:
`docs/superpowers/specs/2026-07-26-lm2-product-memory-integration-design.md`,
`packages/memory-recall/test/rank-project-memories.test.ts`)

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

The benchmark context boundary is now deliberately separate from the product
selector. `Lm2BenchmarkContextBuilder` receives already ordered public
candidates and the harness token budget; it never calls or imitates LM1
capture, correction closure, evidence authorization, or recall. A shared-
candidate fixture proves the intended difference: the benchmark path can emit
a raw superseded projection while LM1 returns its current evidence-valid
correction. LM1 model/path/store internals were split behind compatible public
facades, and an automated source gate keeps every production long-memory
TypeScript and benchmark script at 300 lines or fewer. (source:
`packages/long-memory/src/lm2-benchmark-context.ts`,
`packages/long-memory/test/lm2-benchmark-context.test.ts`,
`packages/long-memory/test/source-size.test.ts`)

LM2 completion now executes its strict evidence JSON Schema rather than using
it as documentation only. Inspection and pinned-checkout preflight remain
ineligible. Full verification alone can report `officialScoreEligible: true`,
after binding each run to a rebuilt canonical domain manifest, exact transport
command/executable digest, and a clean Mega Saver checkout at its recorded
commit. It freshly rebuilds adapter/transport bytes, materializes the full
released questions and haystack for each domain, matches the exact released
trajectory bytes, and binds all input paths plus reader/judge models through
the command and `run_args.json`. Official combined query timing has exactly
`avg_seconds`, `max_seconds`, and `total_seconds`; local percentiles cannot enter
that object, and its floating-point operations use web/enterprise domain totals
and official counts in the pinned combiner's order. The command is restricted
to Python's `-m evaluation.harness` entrypoint plus the complete pinned argparse
surface; its types, choices, defaults, and `run_args.json` must agree. Telemetry
is byte-equivalent to the official per-question metadata, cannot exceed its
harness wall duration after seconds-to-milliseconds conversion, and has its
profile/status/fingerprint/type/image/count fields independently checked against
configuration and manifest identity. Canonical signed-decimal integer lexemes
exclude JavaScript-only exponent/decimal/whitespace coercions and are covered by
a pinned Python argparse fixture. Raw `run_args.json` integer tokens outside
JavaScript's safe range use exact `BigInt` comparison, preserving Python's
unbounded signed-decimal semantics without rounded equality. The raw JSON
reviver lexeme is mandatory for every official integer field: exponent and
decimal-point spellings such as `2e4` and `20000.0` fail at the artifact
boundary instead of collapsing to the same JavaScript `Number`. A structural
pre-parse scan rejects duplicate decoded keys in every JSON object, including
escaped-equivalent names, before last-key-wins parsing can erase ambiguous
evidence; strings remain opaque values during that scan. Per-question
evaluator spec, category, and question text are bound to released input, and
every official judge argument is bound to the recorded judge configuration.
Recorded tar directories and files
are path/type validated before filtering; regular bytes, fresh builder outputs,
and the fresh-versus-recorded tar digest are all compared.
(source: `benchmarks/longmemeval-v2/evidence-schema.json`,
`benchmarks/longmemeval-v2/verify-official-artifacts.mjs`,
`benchmarks/longmemeval-v2/official-evidence-archive.mjs`,
`benchmarks/longmemeval-v2/official-evidence-freshness.mjs`,
`benchmarks/longmemeval-v2/official-evidence-harness-arguments.mjs`,
`benchmarks/longmemeval-v2/official-evidence-json.mjs`,
`benchmarks/longmemeval-v2/official-evidence-run-bindings.mjs`)

Local closure evidence and final gate counts are recorded in the Task 6 report.
No authoritative completed web plus enterprise harness/judge bundle was
available, so full qualification was not run and no official score, dashboard,
latency, or LAFS claim exists. (source: `.superpowers/sdd/task-6-report.md`)

The verifier fails closed on every detected malformed, stale, symlinked, or
identity-mismatched artifact. It does not supply a native anti-tamper anchor:
an actor already able to rewrite the trusted evidence root can also rewrite a
matching lock, ledger, and sidecar set. That trusted-root compromise remains an
explicit threat-model limitation, not an authenticated official-score claim.
(source: `benchmarks/longmemeval-v2/verify-official-artifacts.mjs`,
`docs/superpowers/specs/2026-07-20-long-memory-lm2-runtime-security-completion-design.md`)
