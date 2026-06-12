---
title: Context Audit & Token-Savings Dashboard
tags: [concept, audit, stats, savings, phase-8]
sources:
  - docs/superpowers/specs/2026-06-12-phase8-audit-dashboard-design.md
  - syntheses/contextops-roadmap.md
  - entities/stats.md
status: active
created: 2026-06-12
updated: 2026-06-12
---

# Context Audit & Token-Savings Dashboard

Roadmap Phase 8. Turn Mega Saver's scattered savings signals into **one
deterministic, persisted, windowed audit summary** that answers the
roadmap's exit demo: *"this task would've been 70k tokens, was 23k, 67%
saved."* (source: [[syntheses/contextops-roadmap]]).

## Extends stats, no parallel entity

The shipped `@megasaver/stats` already owns an append-only event log,
atomic summary writes, and a core re-export path. Phase 8 **extends
that package** rather than standing up a parallel entity in core:

- An additive **`AuditEvent`** family (a discriminated union of five
  scalar-only event kinds) written to a **sibling** log
  `<store>/stats/<projectId>/<sessionId>.audit.jsonl`. The existing
  `TokenSaverEvent` byte-log and `SessionTokenSaverStats` are
  **untouched** — no double-counting.
- A pure **`summarizeAudit(events, opts)`** — arithmetic + grouping
  with window filtering (`session | week | all`), unit-testable with no
  store.
- A thin store reader `readAuditEvents(...)` that rejects a partial
  tail, like the existing summary reader.

## Metrics it surfaces

Beyond token bytes: filesConsidered / Included / Excluded, blocks
considered / included / excluded, `repeatedFailuresAvoided`,
`rulesApplied`, `memoriesRetrieved`, `toolSchemasReduced`,
`retryCostSaved`. These are the counts Phases 1/2/3/5/7 emit — this is
the "prove the savings" surface.

## Reconciliation with shipped code

**Done** (PR #121): additive event schema + summarizer + store reader
in `@megasaver/stats`, 4 core re-exports (apps must not import stats
directly — cycle guard), 1 read-only MCP tool (`audit_token_usage`;
tools 23 → 24), and the `mega audit report/last/session/export` group.
No new core entity, no LLM, no estimator of its own (it reuses the
context-pruner line-span estimator).

## Related

- [[syntheses/contextops-roadmap]]
- [[entities/stats]], [[entities/gui]]
- [[concepts/context-pruning-engine]] (shared token estimator)
- [[concepts/failed-run-learning]], [[concepts/tool-router]] (emit counts)
