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
status: LM0 implementation verified; LM1 observations implementation verified; official LongMemEval-V2 score pending
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
