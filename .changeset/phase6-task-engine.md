---
"@megasaver/shared": minor
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Phase 6 — Task Engine. Adds a deterministic task state machine: TaskPlan
with embedded typed TaskSteps (scan/retrieve_context/plan/edit/test/debug/
document/save_memory), dependency-aware status rollup, and selective retry
(reset only the failed step + its transitive dependents, never the whole
plan). The engine is a state tracker, not an executor — the calling agent
runs each step and reports the outcome. New: branded TaskPlanId/TaskStepId,
1 pure transition module, 5 CoreRegistry methods (createTaskPlan, getTaskPlan,
listTaskPlans, recordTaskStep, retryTaskStep), 6 error codes, 4 MCP tools
(build_task_plan, get_task_status, record_task_step, retry_failed_step;
bridge now 22 tools), and CLI (mega task plan/status/step/retry/explain).
Phase 5 (FailedAttempt) and Phase 1 (MemoryEntry) reuse is opt-in. No LLM,
no embeddings.
