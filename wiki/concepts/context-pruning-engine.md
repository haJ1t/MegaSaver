---
title: Context Pruning Engine (LAMR)
tags: [concept, context, pruning, lamr, phase-3]
sources:
  - sources/roadmap-phases-v2.md
  - syntheses/contextops-roadmap.md
  - concepts/context-gate-pipeline.md
  - docs/superpowers/specs/2026-06-25-intent-aware-hook-design.md
  - docs/superpowers/specs/2026-06-25-diff-on-reread-design.md
  - docs/superpowers/specs/2026-06-26-semantic-ast-read-design.md
status: active
created: 2026-06-11
updated: 2026-06-26
---

# Context Pruning Engine (LAMR)

Roadmap Phase 3. Give an agent only the context a task needs. Coding
agents burn most of their token budget on code irrelevant to the
current task; task-aware pruning fixes that. "LAMR" is the roadmap's
borrowed name (source: [[sources/roadmap-phases-v2]]).

## Two dimensions of relevance

1. **Semantic evidence** — is this block directly about the task's
   meaning?
2. **Dependency support** — even if not directly relevant, is it
   needed for a relevant block to work?

A pruner that only does (1) drops the imports and helpers the agent
needs; one that only does (2) keeps everything. LAMR scores both.

## Scoring model (roadmap target)

```
finalScore =
    semanticRelevance
  + dependencyRelevance
  + testFailureRelevance
  + recentEditRelevance
  + memoryRelevance
  + userMentionRelevance
  - stalePenalty
  - noisePenalty
```

Output is a ranked **context pack**: 6–8 blocks, each with a reason
("direct semantic evidence", "dependency support", "failing test
evidence") and a score, plus an explicit excluded list with reasons.
Explainability is a feature, not a nicety.

## Reconciliation with shipped code

The [[concepts/context-gate-pipeline]] already does redact→chunk→rank→
fit→summarize in `@megasaver/output-filter` (9 rank features) +
`@megasaver/context-gate`. But it is **output-centric** — it
compresses one tool's stdout, scoring for errors/test-failures/noise.
LAMR is **task-and-repo-centric** — it scores [[concepts/semantic-repo-index]]
blocks against a task description.

The output-side cousin gained three ranking-input upgrades (scoreChunk
weights themselves unchanged): hook-captured output now ranks against the
session prompt as a **fill-gap** intent (used only when no explicit intent
is present; [[intent-aware-hook]], PR #180); re-reading an unchanged file in
a session is fully suppressed via an `unchanged` marker rather than
re-ranked ([[diff-on-reread]], PR #181); and source-file chunks fed to
`scoreChunk` are **AST-aligned** (functions/classes/headings/JSON keys) not
naive line slices, so coherent declarations get scored (code:
packages/output-filter/src/parsers/semantic.ts, [[semantic-ast-read]], PR
#182).

Status: **shipped** (Phase 3, PR
pending) — `@megasaver/context-pruner` implements the 8-factor model,
selection with dependency closure + token budget (named/failing blocks
never silently dropped), per-block reasons, and a savings audit, exposed
as `mega context build/explain/audit/export` + 4 MCP tools. See
[[entities/context-pruner]]. Spec:
`docs/superpowers/specs/2026-06-11-phase3-context-pruning-lamr-design.md`.

## Why it matters

This is where the headline savings come from (the demo's
53.2k→14.7k, ~72%). Depends on Phase 2 (needs blocks to score) and
reads Phase 1 (memory relevance). Failing-test / changed-file signals
are **passed in as flags** (`--failing-test`, `--changed-file`), not
sourced from Phase 5 — so Phase 3 does not hard-depend on FORGE. A
future tie-in lets Phase 5 `failed_attempt` memories boost a block
(optional; see Phase 3 spec §11).

## Related

- [[syntheses/contextops-roadmap]]
- [[entities/context-pruner]]
- [[concepts/context-gate-pipeline]] (the shipped output-side cousin)
- [[concepts/semantic-repo-index]], [[concepts/structured-memory-engine]]
