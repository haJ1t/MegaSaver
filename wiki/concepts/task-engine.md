---
title: Task Engine
tags: [concept, tasks, planning, phase-6]
sources:
  - docs/superpowers/specs/2026-06-12-phase6-task-engine-design.md
  - syntheses/contextops-roadmap.md
  - entities/core.md
status: active
created: 2026-06-12
updated: 2026-06-12
---

# Task Engine

Roadmap Phase 6 ("Runtime Structured Task Decomposition"). Turn a vague
agent task into an ordered, typed, dependency-aware plan whose progress
is durable and queryable, and whose failures can be retried surgically
(source: [[syntheses/contextops-roadmap]]).

## State tracker, not executor

The critical architectural fact: **Mega Saver has no agent runtime** —
no LLM, no scheduler, no step interpreter inside Core (the
no-LLM/no-embeddings constraint from Phases 1–3 holds). So the Task
Engine is a **deterministic state machine**, not an orchestrator. The
calling agent authors the plan and executes each step; Mega Saver only
records the outcome and rolls it up.

## Shape

- A **`TaskPlan`** is an ordered list of typed `TaskStep`s
  (`scan` / `retrieve_context` / `plan` / `edit` / `test` / `debug` /
  `document` / `save_memory`) with explicit `dependsOn` links.
- Each step has a lifecycle: `pending → running → completed | failed`,
  which rolls up into the plan's status.
- Branded `TaskPlanId` + `TaskStepId`.

## Selective retry (the headline behaviour)

Retrying a failed step resets **only that step and any step that
depends on it** to `pending` — completed work is never re-run
("retry only the failed step + debug, not the whole workflow").

## Reconciliation with shipped code

Net-new and **done** (PR #119): 1 entity module (`task-plan.ts`), 1
pure transition module (`task-plan-transitions.ts`), 5 `CoreRegistry`
methods (`createTaskPlan`, `getTaskPlan`, `listTaskPlans`,
`recordTaskStep`, `retryTaskStep`) on both registry backends, 4 error
codes, 4 MCP tools (`build_task_plan`, `record_task_step`,
`get_task_status`, `retry_failed_step`; tools 18 → 22), and `mega task
plan/status/step/retry/explain`. Phase 5 integration (record a
`FailedAttempt` on failure, save a summary `MemoryEntry` on completion)
is **opt-in**.

## Why it matters

Plans call memory/index/context (Phases 1–3) and feed
[[concepts/failed-run-learning]]; the audit metric `retryCostSaved`
comes from selective retry.

## Related

- [[syntheses/contextops-roadmap]]
- [[concepts/failed-run-learning]] (failed steps → FailedAttempt)
- [[concepts/audit-dashboard]] (retryCostSaved)
- [[entities/core]]
