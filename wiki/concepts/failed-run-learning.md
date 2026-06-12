---
title: Failed-Run Learning (FORGE)
tags: [concept, failures, rules, forge, phase-5]
sources:
  - docs/superpowers/specs/2026-06-12-phase5-forge-failed-run-learning-design.md
  - syntheses/contextops-roadmap.md
  - entities/core.md
status: active
created: 2026-06-12
updated: 2026-06-12
---

# Failed-Run Learning (FORGE)

Roadmap Phase 5. Turn an agent's mistakes into durable project
knowledge: before repeating a class of failure, Mega Saver can warn the
agent ("similar previous failure found … recommended action …").
"FORGE" is the roadmap's borrowed name (source:
[[syntheses/contextops-roadmap]]).

## Core idea

Two first-class entities carry the loop:

- **`FailedAttempt`** — a recorded failed task attempt (task, error,
  related files), append-only with a small closed patch set.
- **`ProjectRule`** — a reusable rule (title, body, severity,
  `appliesTo`) an agent should heed next time. A rule is a
  `MemoryType`, so it lives in [[concepts/structured-memory-engine]].

The learning loop has three moves: **find** similar past failures,
**convert** a failure into a rule, and **rank** the rules that apply to
the current task.

## Deterministic by design

No LLM, no embeddings — ranking is `rankBm25` (from
`@megasaver/retrieval`) plus path overlap, consistent with Phases 1–3.
The intelligence is the **calling agent**: `convert_failure_to_rule`
takes the insight prose the caller writes and does only the
deterministic work — linkage, evidence seeding, `appliesTo`
defaulting, and flipping `convertedToRule` on the source failure.

## Reconciliation with shipped code

Phase 4 shipped the `FailedAttempt` / `ProjectRule` schemas and
create/get/list CRUD plus `record_failed_attempt` / `save_project_rule`
/ `get_project_rules`. Phase 5 (PR #118) added the loop: 2 pure ranking
modules, 3 registry methods (`updateFailedAttempt`,
`searchFailedAttempts`, `convertFailureToRule`), 3 MCP tools
(`find_similar_failures`, `convert_failure_to_rule`,
`get_applicable_rules`; tools 15 → 18), and the `mega fail` / `mega
rules` / `mega learn from-failure` CLI. Status: **done**.

## Why it matters

This is the self-improving differentiator. It feeds the
[[concepts/task-engine]] (a failed step becomes a `FailedAttempt`) and
the [[concepts/audit-dashboard]] metric `repeatedFailuresAvoided`.

## Related

- [[syntheses/contextops-roadmap]]
- [[concepts/structured-memory-engine]] (a rule is a memory type)
- [[concepts/task-engine]], [[concepts/audit-dashboard]]
- [[entities/core]], [[entities/policy]]
