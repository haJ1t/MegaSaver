---
title: Evidence-Backed Long Memory Runtime
tags: [concept, memory, benchmark, evidence, long-memory]
sources:
  - sources/longmemeval-v2.md
  - concepts/structured-memory-engine.md
  - concepts/memory-superset.md
  - docs/superpowers/specs/2026-07-19-long-memory-runtime-design.md
status: approved design
created: 2026-07-19
updated: 2026-07-19
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
