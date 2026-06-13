---
title: Phase 6 — Task Engine — design
risk: MEDIUM
status: draft
created: 2026-06-12
updated: 2026-06-12
related:
  - docs/superpowers/specs/2026-06-12-phase5-forge-failed-run-learning-design.md
  - docs/superpowers/specs/2026-06-11-phase4-mcp-server-design.md
  - docs/superpowers/specs/2026-06-11-phase1-structured-memory-engine-design.md
  - wiki/syntheses/contextops-roadmap.md
  - MegaSaver_Roadmap.txt
---

# Phase 6 — Task Engine — design

## §0 TL;DR

Phase 6 adds a **deterministic task state machine** to the Core Engine.
A `TaskPlan` is an ordered list of typed `TaskStep`s with explicit
dependencies; the engine tracks each step's lifecycle (`pending` →
`running` → `completed | failed`) and rolls that up into the plan's
status. The headline behaviour is **selective retry**: retrying a failed
step resets only that step (and any step that depends on it) to
`pending` — completed work is never re-run.

Net-new = 1 entity module (`task-plan.ts` with embedded `TaskStep`), a
branded `TaskPlanId` + `TaskStepId`, 1 pure state-transition module
(`task-plan-transitions.ts`), 5 `CoreRegistry` methods
(`createTaskPlan`, `getTaskPlan`, `listTaskPlans`, `recordTaskStep`,
`retryTaskStep`) implemented identically on both registry backends, 4
new error codes, 4 MCP tools (tool count 18 → 22), and a CLI surface
(`mega task plan/status/step/retry/explain`). **No executor, no LLM, no
embeddings** — the engine never runs a step; the calling agent does, and
reports the outcome back. Phase 5 integration (record a `FailedAttempt`
on failure, save a summary `MemoryEntry` on completion) is **opt-in**
and reuses existing registry methods.

## §1 Motivation & philosophy — state tracker, not executor

Roadmap Phase 6 ("Runtime Structured Task Decomposition") turns a vague
agent task into an ordered, typed, dependency-aware plan whose progress
is durable and queryable, and whose failures can be retried surgically
("retry only the failed step + debug, not the whole workflow" — roadmap
v0.6).

**The critical architectural fact: MegaSaver has no agent runtime.**
There is no LLM, no shell-executing scheduler, no step interpreter
inside Core (the no-LLM / no-embeddings constraint from Phases 1–3
holds). MegaSaver therefore cannot *execute* a step — it cannot edit a
file, run a test, or debug. So the Task Engine is a **deterministic
state machine**, not an orchestrator:

- The calling agent (Claude Code, Codex, …) **authors** the plan
  (`mega task plan` / `build_task_plan`) and **executes** each step
  itself.
- After executing a step the agent **reports the outcome** back —
  `running` when it starts, `completed` (with optional `output`) or
  `failed` (with optional `error`) when it finishes
  (`mega task step` / `record_task_step`).
- The engine **owns the truth**: which steps are done, which is next,
  what the plan's overall status is, and — on retry — which steps to
  reset. It answers `mega task status` / `get_task_status` and
  `mega task explain`.

`mega task run` from the roadmap shorthand is therefore **not** a
runner. It is intentionally **not** part of this surface; the verb that
advances state is `task step` (mark a step running/completed/failed),
and the verb that surfaces "what now" is `task status`. Documenting this
prevents a future contributor from bolting an executor onto Core and
breaking the agent-agnostic principle (`CLAUDE.md` §1).

## §2 Non-goals

- **No step execution.** The engine never edits, tests, debugs, runs
  commands, or calls an agent. It records outcomes the caller reports.
- **No LLM, no embeddings, no auto-authored steps.** The caller writes
  the plan's steps; the engine does linkage, ordering, and state math.
  Nothing here needs `rankBm25` — there is no ranking surface in Phase 6.
- **No tool routing** (Phase 7), **no audit dashboard / saving counters**
  (Phase 8), **no team/cloud/approval** (Phase 10).
- **No plan/step delete, no step re-ordering, no step content edit after
  create.** A `TaskStep`'s identity, `type`, `title`, and `dependsOn`
  are immutable after `createTaskPlan`; only its lifecycle fields
  (`status`, `output`, `error`, `startedAt`, `completedAt`) mutate, and
  only through the two guarded transitions (`recordTaskStep`,
  `retryTaskStep`).
- **No automatic Phase 5 / Phase 1 writes.** Recording a step `failed`
  *can* also record a `FailedAttempt`, and finishing a plan *can* save a
  summary `MemoryEntry`, but both are explicit opt-in flags/params that
  reuse the existing registry methods — never implicit.

## §3 Entities (`packages/core/src/task-plan.ts`)

### §3a Shape decision — `TaskStep` embedded in `TaskPlan.steps`

A `TaskStep` is embedded in `TaskPlan.steps[]`, not stored as a
separate top-level entity. Rationale:

- It **matches the roadmap schema** (a plan *has* steps).
- A plan + its steps mutate together (record a step → the plan's rolled-
  up status may change); one embedded document means one atomic write
  under one lock, with no cross-file consistency window.
- Steps are meaningless outside their plan — there is no query "list all
  steps across plans". Embedding keeps the bounded context tight.

Steps still get a **branded `TaskStepId`** (globally unique UUID, not a
plan-local index) so that `task step`, `task retry`, and `dependsOn`
can address a step unambiguously and so step ids are stable across
edits to the array. `dependsOn` is a list of `TaskStepId`s referring to
*other steps in the same plan*.

### §3b Branded ids (`packages/shared/src/ids.ts`)

```ts
export const taskPlanIdSchema = lowercaseUuid.brand<"TaskPlanId">();
export type TaskPlanId = z.infer<typeof taskPlanIdSchema>;

export const taskStepIdSchema = lowercaseUuid.brand<"TaskStepId">();
export type TaskStepId = z.infer<typeof taskStepIdSchema>;
```

Same `lowercaseUuid` brand as every other id (filesystem-segment-safe,
case-canonical).

### §3c Closed enums (declaration order is a contract — AA3)

```ts
// Roadmap declaration order (Phase 6): the canonical decomposition pipeline.
export const taskStepTypeSchema = z.enum([
  "scan",
  "retrieve_context",
  "plan",
  "edit",
  "test",
  "debug",
  "document",
  "save_memory",
]);

// Step lifecycle. Order: not-started → in-flight → terminal (fail before
// complete, mirroring failure-first ordering elsewhere).
export const taskStepStatusSchema = z.enum(["pending", "running", "failed", "completed"]);

// Plan lifecycle — same vocabulary as a step, rolled up across all steps.
export const taskPlanStatusSchema = z.enum(["planned", "running", "failed", "completed"]);
```

### §3d `TaskStep` and `TaskPlan` schemas (mirror `memory-entry.ts`)

```ts
export const taskStepSchema = z
  .object({
    id: taskStepIdSchema,
    type: taskStepTypeSchema,
    title: titleSchema,
    description: z.string().trim().min(1).optional(),
    dependsOn: z.array(taskStepIdSchema).default([]),
    status: taskStepStatusSchema.default("pending"),
    output: z.string().trim().min(1).optional(),   // set when completed
    error: z.string().trim().min(1).optional(),     // set when failed
    startedAt: z.string().datetime({ offset: true }).nullable().default(null),
    completedAt: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict();

export const taskPlanSchema = z
  .object({
    id: taskPlanIdSchema,
    projectId: projectIdSchema,
    sessionId: sessionIdSchema.nullable(),
    task: z.string().trim().min(1),
    status: taskPlanStatusSchema.default("planned"),
    steps: z.array(taskStepSchema).min(1),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const ids = new Set(plan.steps.map((s) => s.id));
    if (ids.size !== plan.steps.length) {
      ctx.addIssue({ code: "custom", message: "Duplicate step id in plan.", path: ["steps"] });
    }
    plan.steps.forEach((step, i) => {
      for (const dep of step.dependsOn) {
        if (!ids.has(dep)) {
          ctx.addIssue({
            code: "custom",
            message: `Step ${step.id} dependsOn unknown step ${dep}.`,
            path: ["steps", i, "dependsOn"],
          });
        }
        if (dep === step.id) {
          ctx.addIssue({
            code: "custom",
            message: `Step ${step.id} cannot depend on itself.`,
            path: ["steps", i, "dependsOn"],
          });
        }
      }
    });
  });

export type TaskStep = z.infer<typeof taskStepSchema>;
export type TaskPlan = z.infer<typeof taskPlanSchema>;
```

The `superRefine` enforces the only two structural invariants that a
later consumer would corrupt on: unique step ids, and `dependsOn`
references that resolve to a sibling step (no dangling, no self-loop).
Deeper cycle detection is **not** done in the schema — it lives in the
pure transition module (§4) where retry needs the dependency graph
anyway, and where a clear error code can be returned.

### §3e Plan-status rollup (deterministic, declared once)

`TaskPlan.status` is a pure function of its steps, recomputed on every
mutation so the stored status can never drift from the steps:

- any step `failed` → plan `failed`;
- else any step `running` → plan `running`;
- else all steps `completed` → plan `completed`;
- else → plan `planned`.

This rollup is the function `rollUpPlanStatus(steps)` exported from the
transition module and applied by both registry impls after every record/
retry.

### §3f Create input schema (engine owns ids/timestamps/status)

The caller supplies step *content* but not ids/lifecycle. Mirroring
`failureToRuleInputSchema`, a create-input schema carries only the
caller-authored fields; the registry's `createTaskPlan` mints the plan
id, each step id, and the timestamps, and seeds every step `pending` /
the plan `planned`.

```ts
export const taskStepInputSchema = z
  .object({
    type: taskStepTypeSchema,
    title: titleSchema,
    description: z.string().trim().min(1).optional(),
    // Caller-local dependency handle (e.g. "s1"), resolved to real
    // TaskStepIds by createTaskPlan. Lets a caller express order without
    // knowing engine-minted ids.
    key: z.string().trim().min(1),
    dependsOnKeys: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const taskPlanInputSchema = z
  .object({
    task: z.string().trim().min(1),
    sessionId: sessionIdSchema.nullable().default(null),
    steps: z.array(taskStepInputSchema).min(1),
  })
  .strict()
  .superRefine((input, ctx) => {
    const keys = new Set(input.steps.map((s) => s.key));
    if (keys.size !== input.steps.length) {
      ctx.addIssue({ code: "custom", message: "Duplicate step key.", path: ["steps"] });
    }
    input.steps.forEach((s, i) => {
      for (const dep of s.dependsOnKeys) {
        if (!keys.has(dep)) {
          ctx.addIssue({
            code: "custom",
            message: `Step ${s.key} dependsOnKeys unknown key ${dep}.`,
            path: ["steps", i, "dependsOnKeys"],
          });
        }
      }
    });
  });

export type TaskStepInput = z.infer<typeof taskStepInputSchema>;
export type TaskPlanInput = z.infer<typeof taskPlanInputSchema>;
```

`createTaskPlan` (§5) walks `steps`, mints a `TaskStepId` per `key`,
rewrites `dependsOnKeys` → real `dependsOn` ids, and parses the result
through `taskPlanSchema`. **Why caller-local keys:** the agent writes a
plan in one shot before any id exists; keys let it wire `dependsOn`
without a round-trip. `mintStepId` is injected (the `clock.newId`) so
tests are deterministic.

## §4 Pure transition module (`packages/core/src/task-plan-transitions.ts`)

Pure functions (no I/O), mirroring `memory-search.ts` /
`failed-attempt-search.ts`, so they unit-test without a store. They are
where every state-machine rule lives; the registry methods are thin
wrappers that load → call a transition → write.

```ts
export type StepOutcome =
  | { status: "running" }
  | { status: "completed"; output?: string }
  | { status: "failed"; error?: string };

export function rollUpPlanStatus(steps: readonly TaskStep[]): TaskPlanStatus;

// Apply one reported outcome to one step, returning the new steps array.
// Enforces the legal transition graph; throws TaskTransitionError with a
// code on an illegal move.
export function applyStepOutcome(
  steps: readonly TaskStep[],
  stepId: TaskStepId,
  outcome: StepOutcome,
  now: string,
): TaskStep[];

// Reset a FAILED step (and its transitive dependents) back to pending.
// Throws if the step is not failed.
export function resetFailedStep(
  steps: readonly TaskStep[],
  stepId: TaskStepId,
): TaskStep[];

// Topologically ordered list of step ids ready to run: pending and with
// all dependsOn completed. Powers `task status` "next".
export function readySteps(steps: readonly TaskStep[]): TaskStepId[];
```

`TaskTransitionError` is a small pure error type carrying one of the
Phase 6 codes (§6); the registry catches it and re-throws as a
`CoreRegistryError` with the same code, so the wire/CLI mapping is
uniform.

### §4a `applyStepOutcome` — legal transition graph

For the addressed step (must exist → `task_step_not_found`):

| from \ to   | running | completed | failed |
|-------------|---------|-----------|--------|
| `pending`   | ✅ sets `startedAt` | ✅ (allows skip-to-done) | ✅ |
| `running`   | ➖ idempotent no-op | ✅ sets `completedAt`, `output` | ✅ sets `error` |
| `completed` | ❌ | ➖ idempotent no-op | ❌ |
| `failed`    | ❌ | ❌ | ➖ idempotent no-op |

- A step may only move to `running` if **all `dependsOn` are
  `completed`** — otherwise `task_step_dependency_unmet`.
- ❌ moves throw `task_step_transition_invalid`.
- Setting `completed` clears any stale `error`; setting `failed` clears
  any stale `output`. `completedAt` is set on `completed` **and**
  `failed` (both terminal); `running` sets `startedAt` if unset.
- Idempotent no-ops (➖) return the steps unchanged so a double-report
  from a flaky agent is safe.

### §4b `resetFailedStep` — selective retry (the headline feature)

This is the whole point of Phase 6. Given a step that **must currently
be `failed`** (else `task_step_not_failed`):

1. Reset the target step to `pending`, clearing `error`, `output`,
   `startedAt`, `completedAt`.
2. Compute its **transitive dependents** (every step that, directly or
   transitively, lists the target in `dependsOn`) and reset each of them
   to `pending` too — their inputs are about to change, so any
   already-`completed` dependent must re-run.
3. **Leave every other step untouched** — in particular all `completed`
   steps that the target does not feed. *The whole plan is never reset.*
4. Recompute plan status via `rollUpPlanStatus` (typically `failed` →
   `planned`/`running`).

**The paired debug step.** The roadmap phrase "retry the failed step +
its debug step" is modelled, not special-cased: a `debug` step that
`dependsOn` the failed step is, by definition, a transitive dependent,
so step 2 already resets it. No bespoke "debug pairing" field is needed;
authors express the pairing with `dependsOn`. This is documented so
authors know to wire `debug` → the step it debugs.

Cycle safety: selective retry is cycle-safe — the transitive-dependent
reset is a terminating fixpoint (visited-set) over `dependsOn`, so a
hand-constructed cyclic plan cannot infinite-loop. It does **not** throw
on a cycle; it simply resets every reachable dependent. Cycles cannot
arise through `createTaskPlan` anyway: the create-time `superRefine`
rejects self-loops and dangling refs (deeper multi-node cycles are
unreachable because each `dependsOn` must reference an already-declared
step id).

## §5 Registry methods (`CoreRegistry` + both impls)

Added to the interface and to `createInMemoryCoreRegistry` +
`createJsonDirectoryCoreRegistry`, behaviourally identical (the Phase 4
invariant). Storage mirrors failed-attempts: per-project JSONL at
`task-plans/<projectId>.jsonl`, with `readAllTaskPlans` /
`readTaskPlansForProject` / `writeTaskPlansForProject` added to
`json-directory-store.ts` and `taskPlansDir` added to `StorePaths`.

```ts
createTaskPlan(
  projectId: ProjectId,
  input: TaskPlanInput,
  clock: { now: () => string; newId: () => string },
): TaskPlan;
getTaskPlan(id: TaskPlanId): TaskPlan | null;
listTaskPlans(projectId: ProjectId): TaskPlan[];
recordTaskStep(
  planId: TaskPlanId,
  stepId: TaskStepId,
  outcome: StepOutcome,
  clock: { now: () => string },
): TaskPlan;
retryTaskStep(planId: TaskPlanId, stepId: TaskStepId): TaskPlan;
```

- **`createTaskPlan`** — `requireProject`; validate `sessionId`
  belongs to the project when non-null (same guard as
  `createFailedAttempt`); resolve step keys → minted `TaskStepId`s and
  `dependsOnKeys` → `dependsOn`; parse through `taskPlanSchema`; reject a
  duplicate plan id (`task_plan_already_exists`); write. The plan id and
  every step id come from `clock.newId()` so tests are deterministic
  (the json impl, like every create path, performs the read-dup-check-
  write under one `withDirLock`).
- **`getTaskPlan` / `listTaskPlans`** — read + parse, project-scoped for
  list (`requireProject`). Mirror `getFailedAttempt` / `listFailedAttempts`.
- **`recordTaskStep`** — atomic, single `withDirLock` in json: load the
  plan (`task_plan_not_found`), call `applyStepOutcome(plan.steps, …)`
  (may throw a transition code, re-thrown as `CoreRegistryError`),
  `rollUpPlanStatus`, re-parse `taskPlanSchema`, write. **Phase 5 / Phase
  1 reuse stays out of the registry method** — the registry only mutates
  the plan; the *caller* (MCP handler / CLI) decides whether to also call
  the existing `createFailedAttempt` / `createMemoryEntry`. This keeps
  `recordTaskStep` single-responsibility and avoids cross-entity writes
  buried in a lock.
- **`retryTaskStep`** — atomic, single `withDirLock`: load
  (`task_plan_not_found`), `resetFailedStep` (may throw
  `task_step_not_failed` / `task_step_not_found`), `rollUpPlanStatus`,
  re-parse, write.

> **Critical (json impl):** `recordTaskStep`/`retryTaskStep`/`createTaskPlan`
> do their store reads/writes INLINE inside one `withDirLock`. They never
> call a public lock-taking method (`createFailedAttempt`,
> `createMemoryEntry`, …) from inside the lock — the dir lock is not
> re-entrant. Phase 5 side-effects, when opted in, happen in the *handler*
> after the registry call returns, each taking its own lock.

New `ConvertFailureResult`-style result type is not needed; methods
return the full updated `TaskPlan`.

## §6 New error codes (`packages/core/src/errors.ts`)

Appended to `coreRegistryErrorCodeSchema` (declaration order = append at
end, after `failed_attempt_already_converted`):

```
task_plan_already_exists
task_plan_not_found
task_step_not_found
task_step_not_failed
task_step_transition_invalid
task_step_dependency_unmet
```

- `task_plan_already_exists` — duplicate plan id on create (parity with
  every other create path).
- `task_plan_not_found` / `task_step_not_found` — addressing a missing
  plan / step.
- `task_step_not_failed` — retry guard: only a `failed` step is
  retryable.
- `task_step_transition_invalid` — an illegal lifecycle move (§4a ❌).
- `task_step_dependency_unmet` — `running` requested before all
  `dependsOn` are `completed`.

(Mandate named `task_plan_not_found`, `task_step_not_found`,
`task_step_not_failed`; the three extras make the state machine total.)

## §7 MCP tools (`packages/mcp-bridge`, 18 → 22)

Each handler mirrors the Phase 4/5 tool shape (zod input → resolve →
registry call → JSON result; map `CoreRegistryError` codes to wire
codes). New names slot alphabetically into `tool-name.ts` and `TOOL_DEFS`.

| Tool | Input | Output | Backing |
|------|-------|--------|---------|
| `build_task_plan` | `projectId, task, sessionId?, steps[]` (each `{type,title,description?,key,dependsOnKeys?}`) | `{ plan }` | `createTaskPlan` |
| `get_task_status` | `planId` | `{ plan, ready: TaskStepId[] }` | `getTaskPlan` + `readySteps` |
| `record_task_step` | `planId, stepId, status(running\|completed\|failed), output?, error?, recordFailure?` | `{ plan }` | `recordTaskStep` (+ opt-in `createFailedAttempt`) |
| `retry_failed_step` | `planId, stepId` | `{ plan }` | `retryTaskStep` |

- `build_task_plan` is the agent's "decompose this task" call;
  `get_task_status` is "what's done / what's next"; `record_task_step` is
  "I just ran step X, here's the outcome"; `retry_failed_step` is the
  selective-retry trigger.
- **Phase 5 opt-in:** `record_task_step` accepts `recordFailure?: boolean`
  (default false). When `status:"failed"` *and* `recordFailure:true`, the
  handler — *after* the `recordTaskStep` returns — calls the existing
  `registry.createFailedAttempt(...)` with the step's title/error,
  reusing the Phase 4/5 method. No new failure logic. (A summary-memory
  opt-in lives in the CLI `task status --save-summary`; see §8 — it is
  not exposed as a separate MCP param to keep the tool inputs minimal,
  and any agent can call `save_memory` directly.)
- Error mapping: `task_plan_not_found` / `task_step_not_found` →
  `resource_not_found`; `task_step_not_failed` /
  `task_step_transition_invalid` / `task_step_dependency_unmet` /
  `project_not_found` → `validation_failed` (and `project_not_found`
  specifically → `resource_not_found`, matching the existing handlers).

Final enum (22, alphabetic): build_task_plan, convert_failure_to_rule,
explain_context_selection, find_similar_failures, get_applicable_rules,
get_context_budget_report, get_project_context, get_project_rules,
get_relevant_code_blocks, get_relevant_context, get_relevant_memories,
get_task_status, mega_fetch_chunk, mega_read_file, mega_recall,
mega_run_command, record_failed_attempt, record_task_step,
retry_failed_step, save_memory, save_project_rule, search_memory.

## §8 CLI (`apps/cli`, citty)

New command group `mega task` registered in `apps/cli/src/main.ts`
`subCommands`, following the `fail`/`rules` structure (one dir per group,
citty `defineCommand`, `run<Name>(input): Promise<0 | 1>`, shared output
helpers, `MEGA_TEST_*` deterministic ids via `readTestEnv`, reusing
`mapErrorToCliMessage` / `projectNotFoundMessage` / `ensureStoreReady` /
`resolveStorePath` / `readStoreEnv`).

`apps/cli/src/commands/task/` → `plan`, `status`, `step`, `retry`,
`explain` (+ `shared.ts`, `index.ts`):

- **`mega task plan <project> --task "..." --step "type:title[:key]" …`**
  Builds a `TaskPlan`. Steps are passed as repeatable `--step` flags in a
  compact `type:title` form (optionally `type:title:key` and
  `--depends key,key` per step is awkward on a flat CLI, so the CLI
  supports a `--steps-json '<json>'` escape hatch for dependency-rich
  plans; the simple repeatable `--step` form creates a linear chain where
  each step `dependsOn` the previous). Prints the plan id (or JSON).
  Deterministic ids via `MEGA_TEST_TASK_PLAN_ID` / injected `newId`.
- **`mega task status <planId>`** Prints the rolled-up plan status, a
  per-step line (`stepId  status  type  title`), and the `ready` step
  ids. `--save-summary "<text>"` (opt-in) additionally calls the existing
  `registry.createMemoryEntry` with a `code_pattern`/`decision`-typed
  summary memory **only when the plan status is `completed`** (else prints
  `error: plan not completed` and returns 1) — Phase 1 reuse, explicit.
- **`mega task step <planId> <stepId> --status running|completed|failed
  [--output ... | --error ...] [--record-failure]`** Advances one step.
  `--record-failure` (opt-in, only meaningful with `--status failed`)
  also records a `FailedAttempt` via the existing method. Prints the new
  plan status + the step's status.
- **`mega task retry <planId> <stepId>`** Selective retry; prints which
  steps were reset to `pending` and the new plan status.
- **`mega task explain <planId>`** Human-readable walkthrough: the task,
  each step with type/status/dependsOn, why each `ready`/blocked step is
  in that state (e.g. "blocked: waiting on <stepId> (running)"), and the
  retry rule reminder. Pure formatting over `getTaskPlan` + `readySteps`;
  no new registry call.

CLI resolves the active project by name the same way existing commands
do. No new resolution logic.

## §9 Reconciliation

- Tool enum stays a closed alphabetic set (AA1 §8a/§17); +4 names,
  18 → 22.
- `TaskStep.type = save_memory` is a *step type*, not a write trigger:
  the engine does not save memory when a `save_memory` step is recorded
  `completed`. Saving is the caller's job (the agent ran the save and
  reports done), with the CLI `--save-summary` / MCP `save_memory` as the
  opt-in path. This keeps "tracker not executor" intact even for the
  memory-shaped step type.
- No new cross-package dependency: core gains no new external dep (no
  `rankBm25` use here); mcp-bridge and cli already depend on core and
  shared.
- `sessionId` validation reuses the `createFailedAttempt` guard pattern;
  no new session logic.

## §10 Risk

MEDIUM. Additive — no existing schema/store/tool *changes* shape, only
new entities/methods/tools. Main risks:

1. **State-machine totality.** Every (from,to) pair and every
   dependency edge must have a defined, tested outcome — an undefined
   transition that silently passes would corrupt plan truth. Covered by
   exhaustive transition tests in §11 and the `applyStepOutcome` table.
2. **Selective-retry correctness.** Resetting too much (whole plan) or
   too little (forgetting transitive dependents) both break the headline
   feature. Covered by tests: target-only reset when nothing depends on
   it; target + debug dependent reset; untouched completed siblings;
   `task_step_not_failed` guard.
3. **Atomicity (json impl).** Plan + step mutation in one write under one
   non-re-entrant lock; Phase 5/1 side-effects strictly *outside* the
   lock, in the handler. Flagged in §5.
4. **Cycle safety.** Create-time refinement + visited-set walks prevent
   infinite loops; a cyclic hand-built plan throws, never hangs.

## §11 Testing (TDD — tests first)

- **Pure transitions (`task-plan-transitions.ts`):**
  `rollUpPlanStatus` (each of the four cases); `applyStepOutcome` (every
  ✅ move sets the right timestamps/fields; every ❌ throws
  `task_step_transition_invalid`; idempotent no-ops; `running` with
  unmet deps → `task_step_dependency_unmet`; missing step →
  `task_step_not_found`); `resetFailedStep` (target-only; target +
  transitive dependents incl. a `debug` step; untouched completed
  siblings; non-failed → `task_step_not_failed`; cycle guard);
  `readySteps` (only pending-with-completed-deps, deterministic order).
- **Entity schemas (`task-plan.ts`):** `taskPlanSchema` (duplicate step
  id rejected, dangling/self `dependsOn` rejected, defaults seed
  `pending`/`planned`); `taskPlanInputSchema` (duplicate key, dangling
  `dependsOnKeys` rejected); strict-mode unknown-key rejection on both.
- **Registry (both impls, shared suite):** `createTaskPlan` (mints ids,
  resolves keys→dependsOn, requireProject, sessionId guard, duplicate
  plan id); `getTaskPlan`/`listTaskPlans` (project scoping);
  `recordTaskStep` (happy path rolls up status, illegal move throws,
  not-found); `retryTaskStep` (selective reset, not-failed guard,
  not-found). Run identically against in-memory and json-directory.
- **MCP handlers (`task-tools.test.ts`):** `build_task_plan` (happy +
  bad input + unknown project), `get_task_status` (plan + ready, unknown
  plan → resource_not_found), `record_task_step` (happy, illegal move →
  validation_failed, `recordFailure:true` writes a `FailedAttempt`),
  `retry_failed_step` (resets, not-failed → validation_failed).
- **Server e2e:** `ListTools` returns 22; a `build_task_plan` →
  `record_task_step(failed)` → `retry_failed_step` →
  `record_task_step(completed)` → `get_task_status` round-trip through
  the bridge shows selective retry and a final `completed` plan.
- **CLI:** `mega task plan` prints an id and a linear chain; `mega task
  step` advances + `--record-failure` records a failure; `mega task
  retry` resets only the failed step (+ dependent); `mega task status`
  shows ready steps and `--save-summary` writes a memory only when
  completed; `mega task explain` renders blocked-reason lines. Follow the
  existing CLI command test patterns (`fail.test.ts`, `rules.test.ts`).

## §12 Decisions / open questions

- **Decided:** state tracker, not executor — no `task run` runner verb;
  `task step` advances state, `task status` answers "what now".
- **Decided:** `TaskStep` embedded in `TaskPlan.steps` (atomic, matches
  roadmap), but each step carries a branded `TaskStepId` for stable
  addressing and `dependsOn`.
- **Decided:** "retry the failed step + its debug step" is modelled via
  `dependsOn` transitive-dependent reset, not a bespoke debug field.
- **Decided:** Phase 5 (`FailedAttempt`) and Phase 1 (`MemoryEntry`)
  writes are opt-in, in the handler/CLI *after* the registry call, never
  inside `recordTaskStep` and never automatic.
- **Decided:** caller-local step `key`s in the create input resolve to
  engine-minted ids, so an agent can author a dependency graph in one
  call without a round-trip.
- **Decided:** plan status is a recomputed rollup, never independently
  settable — stored status cannot drift from steps.
- **Open (low):** the flat-CLI `--step type:title` linear-chain
  convenience vs `--steps-json` for dependency-rich plans. Start with
  both (chain for the common case, JSON escape hatch for graphs); revisit
  the flag ergonomics if real use shows the JSON form is the norm. Not
  blocking — the MCP `build_task_plan` already takes full structured
  steps.

## §13 Out of scope

Step execution / any runner; LLM / embeddings / auto-authored steps;
ranking (no `rankBm25` here); tool routing (Phase 7); audit dashboard and
saved-counter metrics (Phase 8); team/cloud/approval flow (Phase 10);
plan/step delete, re-order, or post-create content edit.
