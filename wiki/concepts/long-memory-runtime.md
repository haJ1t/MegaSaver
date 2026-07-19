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
status: LM0 implementation verified; LM1 design and TDD plan approved
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

LM1 design is approved for durable, immutable snapshots/transitions with
evidence-binding authorization, retry-stable Evidence Ledger adoption, and
revocation-aware recall. It preserves LM0's TypeScript and JSONL boundaries;
implementation remains gated on a TDD plan, fresh review, and verification.
(source: `docs/superpowers/specs/2026-07-20-long-memory-lm1-observations-design.md`)

Its six-task plan fixes contracts and public-surface compatibility first, then
immutable storage, evidence-bound capture, correction-aware transitions,
bounded recall, and independent verification. (source:
`docs/superpowers/plans/2026-07-20-long-memory-lm1-observations-plan.md`)
