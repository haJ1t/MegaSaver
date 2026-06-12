# Phase 6 — Task Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic task state machine to Core — `TaskPlan` with embedded typed `TaskStep`s, dependency-aware status rollup, and **selective retry** (reset only the failed step + its transitive dependents) — via 1 entity module, 1 pure transition module, 5 `CoreRegistry` methods, 4 error codes, 4 MCP tools (18→22), and a `mega task` CLI. No executor, no LLM, no embeddings; the calling agent runs steps and reports outcomes.

**Architecture:** Pure functions (`rollUpPlanStatus`, `applyStepOutcome`, `resetFailedStep`, `readySteps`) hold every state-machine rule and unit-test without a store. Five `CoreRegistry` methods (`createTaskPlan`, `getTaskPlan`, `listTaskPlans`, `recordTaskStep`, `retryTaskStep`) are implemented identically on the in-memory and json-directory backends; the mutating ones run under one non-re-entrant `withDirLock` in the json impl. Phase 5 (`createFailedAttempt`) and Phase 1 (`createMemoryEntry`) reuse is opt-in and happens in the MCP/CLI layer *after* the registry call, never inside the lock. MCP tools and CLI commands are thin handlers, mirroring Phases 4–5.

**Tech Stack:** TypeScript (strict ESM, `exactOptionalPropertyTypes`), zod, vitest, citty (CLI), `@modelcontextprotocol/sdk`, pnpm + turbo, biome.

**Spec:** `docs/superpowers/specs/2026-06-12-phase6-task-engine-design.md`
**Working dir:** `.worktrees/phase6-task` (branch `feat/phase6-task-engine`, off `main` @ Phase 5).

**Test commands:** per-package `pnpm --filter @megasaver/<pkg> test <pattern>`; type `pnpm --filter @megasaver/<pkg> typecheck`. Final gate: `pnpm verify` (= `pnpm lint && pnpm typecheck && pnpm test && pnpm conventions:check`; lint is `biome check .` over the whole repo — run it, the per-package turbo lint misses repo-wide format/import-sort). Run `biome check --write` on new files before committing so lint stays clean. Workspace packages resolve to built `dist/`; if a dependent test fails on an unresolved `@megasaver/*` import, build that dep first (`pnpm --filter @megasaver/<dep> build`).

---

## File Structure

**Create (shared):**
- (modify) `packages/shared/src/ids.ts` — `taskPlanIdSchema`, `taskStepIdSchema`
- (modify test) `packages/shared/test/ids.test.ts` — brand coverage (if such a test exists; else fold into core schema test)

**Create (core):**
- `packages/core/src/task-plan.ts` — entities + enums + create-input schemas
- `packages/core/src/task-plan-transitions.ts` — pure state machine
- `packages/core/test/task-plan-schema.test.ts`
- `packages/core/test/task-plan-transitions.test.ts`
- `packages/core/test/registry-task.test.ts` — registry methods (both impls)

**Modify (core):**
- `packages/core/src/errors.ts` — 6 new codes
- `packages/core/src/json-directory-store.ts` — `taskPlansDir` + read/write helpers
- `packages/core/src/registry.ts` — interface + in-memory impl
- `packages/core/src/json-directory-registry.ts` — json impl
- `packages/core/src/index.ts` — barrel exports

**Create (mcp-bridge):**
- `packages/mcp-bridge/src/tools/build-task-plan.ts`
- `packages/mcp-bridge/src/tools/get-task-status.ts`
- `packages/mcp-bridge/src/tools/record-task-step.ts`
- `packages/mcp-bridge/src/tools/retry-failed-step.ts`
- `packages/mcp-bridge/test/tools/task-tools.test.ts`

**Modify (mcp-bridge):**
- `packages/mcp-bridge/src/tool-name.ts` (18→22) + `test/tool-name.test-d.ts`
- `packages/mcp-bridge/src/server.ts`
- `packages/mcp-bridge/test/server.e2e.test.ts`

**Create (cli):** `apps/cli/src/commands/task/{index,plan,status,step,retry,explain,shared}.ts` + `apps/cli/test/task.test.ts`.
**Modify (cli):** `apps/cli/src/main.ts`.

**Create (release):** `.changeset/phase6-task-engine.md`.

---

## Task 1: Branded ids — TaskPlanId, TaskStepId

**Files:**
- Modify: `packages/shared/src/ids.ts` (append)
- Test: `packages/core/test/task-plan-schema.test.ts` (created here; extended in Task 3)

- [ ] **Step 1: Write the failing test** (`packages/core/test/task-plan-schema.test.ts`)

```ts
import { taskPlanIdSchema, taskStepIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";

describe("task ids", () => {
  it("brands a lowercase uuid as TaskPlanId / TaskStepId", () => {
    const planId = taskPlanIdSchema.parse("d0000000-0000-4000-8000-000000000001");
    const stepId = taskStepIdSchema.parse("d0000000-0000-4000-8000-000000000002");
    expect(planId).toBe("d0000000-0000-4000-8000-000000000001");
    expect(stepId).toBe("d0000000-0000-4000-8000-000000000002");
  });
  it("rejects an uppercase uuid", () => {
    expect(() => taskPlanIdSchema.parse("D0000000-0000-4000-8000-000000000001")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test task-plan-schema`
Expected: FAIL — `taskPlanIdSchema` / `taskStepIdSchema` not exported. (Build shared first if `@megasaver/shared` won't resolve: `pnpm --filter @megasaver/shared build`.)

- [ ] **Step 3: Append to `packages/shared/src/ids.ts`**

```ts
export const taskPlanIdSchema = lowercaseUuid.brand<"TaskPlanId">();
export type TaskPlanId = z.infer<typeof taskPlanIdSchema>;

export const taskStepIdSchema = lowercaseUuid.brand<"TaskStepId">();
export type TaskStepId = z.infer<typeof taskStepIdSchema>;
```

(`lowercaseUuid` and `z` are already declared/imported at the top of `ids.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/shared build && pnpm --filter @megasaver/core test task-plan-schema`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/ids.ts packages/core/test/task-plan-schema.test.ts
git commit -m "feat(shared): TaskPlanId + TaskStepId branded ids"
```

---

## Task 2: Registry error codes

**Files:**
- Modify: `packages/core/src/errors.ts` (the `coreRegistryErrorCodeSchema` enum)
- Test: `packages/core/test/errors-task.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { coreRegistryErrorCodeSchema } from "../src/errors.js";

describe("phase 6 registry error codes", () => {
  it("includes the six task codes", () => {
    for (const code of [
      "task_plan_already_exists",
      "task_plan_not_found",
      "task_step_not_found",
      "task_step_not_failed",
      "task_step_transition_invalid",
      "task_step_dependency_unmet",
    ] as const) {
      expect(coreRegistryErrorCodeSchema.parse(code)).toBe(code);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test errors-task`
Expected: FAIL.

- [ ] **Step 3: Append the codes** as the last members of `coreRegistryErrorCodeSchema` in `packages/core/src/errors.ts`, after `"failed_attempt_already_converted",`:

```ts
  "task_plan_already_exists",
  "task_plan_not_found",
  "task_step_not_found",
  "task_step_not_failed",
  "task_step_transition_invalid",
  "task_step_dependency_unmet",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test errors-task`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/errors.ts packages/core/test/errors-task.test.ts
git commit -m "feat(core): Phase 6 task-engine registry error codes"
```

---

## Task 3: Entity module — task-plan.ts (enums, schemas, create-input)

**Files:**
- Create: `packages/core/src/task-plan.ts`
- Test: `packages/core/test/task-plan-schema.test.ts` (append to the file from Task 1)

- [ ] **Step 1: Append the failing test**

Add imports at the top of `task-plan-schema.test.ts`:

```ts
import {
  taskPlanInputSchema,
  taskPlanSchema,
  taskStepStatusSchema,
  taskStepTypeSchema,
} from "../src/task-plan.js";
```

Append:

```ts
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const S1 = "d0000000-0000-4000-8000-000000000011";
const S2 = "d0000000-0000-4000-8000-000000000012";
const TS = "2026-06-12T00:00:00.000Z";

function step(id: string, over: Record<string, unknown> = {}) {
  return { id, type: "edit", title: "do a thing", dependsOn: [], status: "pending", ...over };
}
function plan(over: Record<string, unknown> = {}) {
  return {
    id: "d0000000-0000-4000-8000-000000000001",
    projectId: PROJECT_ID,
    sessionId: null,
    task: "fix the login bug",
    status: "planned",
    steps: [step(S1)],
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}

describe("enum declaration order", () => {
  it("taskStepTypeSchema is roadmap order", () => {
    expect(taskStepTypeSchema.options).toEqual([
      "scan",
      "retrieve_context",
      "plan",
      "edit",
      "test",
      "debug",
      "document",
      "save_memory",
    ]);
  });
  it("taskStepStatusSchema is pending|running|failed|completed", () => {
    expect(taskStepStatusSchema.options).toEqual(["pending", "running", "failed", "completed"]);
  });
});

describe("taskPlanSchema", () => {
  it("parses a minimal plan and seeds step defaults", () => {
    const parsed = taskPlanSchema.parse(plan());
    expect(parsed.steps[0]?.status).toBe("pending");
    expect(parsed.steps[0]?.startedAt).toBeNull();
  });
  it("rejects a duplicate step id", () => {
    expect(() => taskPlanSchema.parse(plan({ steps: [step(S1), step(S1)] }))).toThrow();
  });
  it("rejects a dependsOn that references an unknown step", () => {
    expect(() => taskPlanSchema.parse(plan({ steps: [step(S1, { dependsOn: [S2] })] }))).toThrow();
  });
  it("rejects a self-dependency", () => {
    expect(() => taskPlanSchema.parse(plan({ steps: [step(S1, { dependsOn: [S1] })] }))).toThrow();
  });
  it("rejects an empty steps array", () => {
    expect(() => taskPlanSchema.parse(plan({ steps: [] }))).toThrow();
  });
  it("rejects unknown top-level keys (strict)", () => {
    expect(() => taskPlanSchema.parse(plan({ extra: 1 }))).toThrow();
  });
});

describe("taskPlanInputSchema", () => {
  it("parses caller steps with local keys + dependsOnKeys", () => {
    const parsed = taskPlanInputSchema.parse({
      task: "t",
      sessionId: null,
      steps: [
        { type: "edit", title: "edit it", key: "a" },
        { type: "test", title: "test it", key: "b", dependsOnKeys: ["a"] },
      ],
    });
    expect(parsed.steps[1]?.dependsOnKeys).toEqual(["a"]);
  });
  it("rejects a duplicate key", () => {
    expect(() =>
      taskPlanInputSchema.parse({
        task: "t",
        steps: [
          { type: "edit", title: "x", key: "a" },
          { type: "test", title: "y", key: "a" },
        ],
      }),
    ).toThrow();
  });
  it("rejects dependsOnKeys referencing an unknown key", () => {
    expect(() =>
      taskPlanInputSchema.parse({
        task: "t",
        steps: [{ type: "edit", title: "x", key: "a", dependsOnKeys: ["zzz"] }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test task-plan-schema`
Expected: FAIL — module `task-plan.js` missing.

- [ ] **Step 3: Write `packages/core/src/task-plan.ts`**

```ts
import {
  projectIdSchema,
  sessionIdSchema,
  taskPlanIdSchema,
  taskStepIdSchema,
  titleSchema,
} from "@megasaver/shared";
import { z } from "zod";

// Roadmap declaration order (Phase 6): the canonical decomposition pipeline.
// AA3 convention: declaration order is a contract.
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
export type TaskStepType = z.infer<typeof taskStepTypeSchema>;

// Step lifecycle. Order: not-started -> in-flight -> terminal (fail before
// complete, mirroring the failure-first ordering used elsewhere).
export const taskStepStatusSchema = z.enum(["pending", "running", "failed", "completed"]);
export type TaskStepStatus = z.infer<typeof taskStepStatusSchema>;

// Plan lifecycle — same vocabulary as a step, rolled up across all steps.
export const taskPlanStatusSchema = z.enum(["planned", "running", "failed", "completed"]);
export type TaskPlanStatus = z.infer<typeof taskPlanStatusSchema>;

export const taskStepSchema = z
  .object({
    id: taskStepIdSchema,
    type: taskStepTypeSchema,
    title: titleSchema,
    description: z.string().trim().min(1).optional(),
    dependsOn: z.array(taskStepIdSchema).default([]),
    status: taskStepStatusSchema.default("pending"),
    output: z.string().trim().min(1).optional(),
    error: z.string().trim().min(1).optional(),
    startedAt: z.string().datetime({ offset: true }).nullable().default(null),
    completedAt: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict();

export type TaskStep = z.infer<typeof taskStepSchema>;

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
        if (dep === step.id) {
          ctx.addIssue({
            code: "custom",
            message: `Step ${step.id} cannot depend on itself.`,
            path: ["steps", i, "dependsOn"],
          });
        } else if (!ids.has(dep)) {
          ctx.addIssue({
            code: "custom",
            message: `Step ${step.id} dependsOn unknown step ${dep}.`,
            path: ["steps", i, "dependsOn"],
          });
        }
      }
    });
  });

export type TaskPlan = z.infer<typeof taskPlanSchema>;

// Caller-supplied plan: the agent authors step content with local string
// keys (no engine id exists yet); createTaskPlan resolves keys -> minted
// TaskStepIds and dependsOnKeys -> dependsOn. Mirrors failureToRuleInputSchema:
// id/status/timestamps are engine-owned.
export const taskStepInputSchema = z
  .object({
    type: taskStepTypeSchema,
    title: titleSchema,
    description: z.string().trim().min(1).optional(),
    key: z.string().trim().min(1),
    dependsOnKeys: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export type TaskStepInput = z.infer<typeof taskStepInputSchema>;

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

export type TaskPlanInput = z.infer<typeof taskPlanInputSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test task-plan-schema`
Expected: PASS (2 from Task 1 + the new describe blocks).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/task-plan.ts packages/core/test/task-plan-schema.test.ts
git commit -m "feat(core): TaskPlan + TaskStep entity schemas and create-input"
```

---

## Task 4: Pure transition module — task-plan-transitions.ts

**Files:**
- Create: `packages/core/src/task-plan-transitions.ts`
- Test: `packages/core/test/task-plan-transitions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import type { TaskStepId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import type { TaskStep } from "../src/task-plan.js";
import {
  TaskTransitionError,
  applyStepOutcome,
  readySteps,
  resetFailedStep,
  rollUpPlanStatus,
} from "../src/task-plan-transitions.js";

const A = "d0000000-0000-4000-8000-00000000000a" as TaskStepId;
const B = "d0000000-0000-4000-8000-00000000000b" as TaskStepId;
const C = "d0000000-0000-4000-8000-00000000000c" as TaskStepId;
const TS = "2026-06-12T01:00:00.000Z";

function s(id: TaskStepId, over: Partial<TaskStep> = {}): TaskStep {
  return {
    id,
    type: "edit",
    title: "t",
    dependsOn: [],
    status: "pending",
    startedAt: null,
    completedAt: null,
    ...over,
  } as TaskStep;
}

describe("rollUpPlanStatus", () => {
  it("failed wins", () => {
    expect(rollUpPlanStatus([s(A, { status: "completed" }), s(B, { status: "failed" })])).toBe(
      "failed",
    );
  });
  it("running when no failure", () => {
    expect(rollUpPlanStatus([s(A, { status: "completed" }), s(B, { status: "running" })])).toBe(
      "running",
    );
  });
  it("completed when all completed", () => {
    expect(rollUpPlanStatus([s(A, { status: "completed" })])).toBe("completed");
  });
  it("planned otherwise", () => {
    expect(rollUpPlanStatus([s(A, { status: "pending" })])).toBe("planned");
  });
});

describe("applyStepOutcome", () => {
  it("pending -> running sets startedAt when deps met", () => {
    const out = applyStepOutcome([s(A)], A, { status: "running" }, TS);
    expect(out[0]?.status).toBe("running");
    expect(out[0]?.startedAt).toBe(TS);
  });
  it("running -> completed sets completedAt + output, clears error", () => {
    const out = applyStepOutcome(
      [s(A, { status: "running", error: "old" })],
      A,
      { status: "completed", output: "done" },
      TS,
    );
    expect(out[0]?.status).toBe("completed");
    expect(out[0]?.completedAt).toBe(TS);
    expect(out[0]?.output).toBe("done");
    expect(out[0]?.error).toBeUndefined();
  });
  it("running -> failed sets error + completedAt, clears output", () => {
    const out = applyStepOutcome(
      [s(A, { status: "running", output: "old" })],
      A,
      { status: "failed", error: "boom" },
      TS,
    );
    expect(out[0]?.status).toBe("failed");
    expect(out[0]?.error).toBe("boom");
    expect(out[0]?.output).toBeUndefined();
  });
  it("rejects running before deps completed", () => {
    const steps = [s(A, { status: "running" }), s(B, { dependsOn: [A] })];
    expect(() => applyStepOutcome(steps, B, { status: "running" }, TS)).toThrowError(
      TaskTransitionError,
    );
    expect(() => applyStepOutcome(steps, B, { status: "running" }, TS)).toThrowError(
      /task_step_dependency_unmet/,
    );
  });
  it("rejects completed -> running", () => {
    expect(() =>
      applyStepOutcome([s(A, { status: "completed" })], A, { status: "running" }, TS),
    ).toThrowError(/task_step_transition_invalid/);
  });
  it("is an idempotent no-op for same terminal status", () => {
    const steps = [s(A, { status: "completed", completedAt: TS })];
    expect(applyStepOutcome(steps, A, { status: "completed" }, "2026-06-12T09:00:00.000Z")).toEqual(
      steps,
    );
  });
  it("throws task_step_not_found for an unknown step", () => {
    expect(() => applyStepOutcome([s(A)], B, { status: "running" }, TS)).toThrowError(
      /task_step_not_found/,
    );
  });
});

describe("resetFailedStep", () => {
  it("resets only the failed step when nothing depends on it", () => {
    const steps = [s(A, { status: "completed" }), s(B, { status: "failed", error: "x" })];
    const out = resetFailedStep(steps, B);
    expect(out.find((x) => x.id === A)?.status).toBe("completed");
    const reset = out.find((x) => x.id === B);
    expect(reset?.status).toBe("pending");
    expect(reset?.error).toBeUndefined();
    expect(reset?.startedAt).toBeNull();
  });
  it("resets the failed step AND its transitive dependents (incl. a debug step)", () => {
    const steps = [
      s(A, { status: "failed", error: "x", type: "edit" }),
      s(B, { status: "completed", dependsOn: [A], type: "debug" }),
      s(C, { status: "completed", dependsOn: [B], type: "test" }),
    ];
    const out = resetFailedStep(steps, A);
    expect(out.map((x) => x.status)).toEqual(["pending", "pending", "pending"]);
  });
  it("leaves a completed sibling that does not depend on the target untouched", () => {
    const steps = [
      s(A, { status: "failed", error: "x" }),
      s(B, { status: "completed" }),
    ];
    const out = resetFailedStep(steps, A);
    expect(out.find((x) => x.id === B)?.status).toBe("completed");
  });
  it("throws task_step_not_failed when the step is not failed", () => {
    expect(() => resetFailedStep([s(A, { status: "completed" })], A)).toThrowError(
      /task_step_not_failed/,
    );
  });
  it("throws task_step_not_found for an unknown step", () => {
    expect(() => resetFailedStep([s(A, { status: "failed" })], B)).toThrowError(
      /task_step_not_found/,
    );
  });
});

describe("readySteps", () => {
  it("returns pending steps whose deps are all completed", () => {
    const steps = [
      s(A, { status: "completed" }),
      s(B, { status: "pending", dependsOn: [A] }),
      s(C, { status: "pending", dependsOn: [B] }),
    ];
    expect(readySteps(steps)).toEqual([B]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test task-plan-transitions`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `packages/core/src/task-plan-transitions.ts`**

```ts
import type { TaskStepId } from "@megasaver/shared";
import type { CoreRegistryErrorCode } from "./errors.js";
import type { TaskPlanStatus, TaskStep } from "./task-plan.js";

// Pure state-machine error carrying a Phase 6 registry code; the registry
// catches it and re-throws as a CoreRegistryError with the same code so the
// wire/CLI mapping is uniform.
export class TaskTransitionError extends Error {
  readonly code: CoreRegistryErrorCode;
  constructor(code: CoreRegistryErrorCode, message: string) {
    super(message);
    this.name = "TaskTransitionError";
    this.code = code;
  }
}

export type StepOutcome =
  | { status: "running" }
  | { status: "completed"; output?: string }
  | { status: "failed"; error?: string };

export function rollUpPlanStatus(steps: readonly TaskStep[]): TaskPlanStatus {
  if (steps.some((s) => s.status === "failed")) return "failed";
  if (steps.some((s) => s.status === "running")) return "running";
  if (steps.every((s) => s.status === "completed")) return "completed";
  return "planned";
}

function requireStep(steps: readonly TaskStep[], stepId: TaskStepId): TaskStep {
  const step = steps.find((s) => s.id === stepId);
  if (!step) {
    throw new TaskTransitionError("task_step_not_found", `Task step does not exist: ${stepId}`);
  }
  return step;
}

// Legal lifecycle moves (spec §4a). Idempotent same-status moves are no-ops.
export function applyStepOutcome(
  steps: readonly TaskStep[],
  stepId: TaskStepId,
  outcome: StepOutcome,
  now: string,
): TaskStep[] {
  const step = requireStep(steps, stepId);

  if (step.status === outcome.status) {
    return [...steps];
  }

  const from = step.status;
  const to = outcome.status;
  const legal =
    (from === "pending" && (to === "running" || to === "completed" || to === "failed")) ||
    (from === "running" && (to === "completed" || to === "failed"));
  if (!legal) {
    throw new TaskTransitionError(
      "task_step_transition_invalid",
      `Illegal task step transition ${from} -> ${to} for ${stepId}.`,
    );
  }

  if (to === "running") {
    const depsMet = step.dependsOn.every(
      (dep) => steps.find((s) => s.id === dep)?.status === "completed",
    );
    if (!depsMet) {
      throw new TaskTransitionError(
        "task_step_dependency_unmet",
        `Task step ${stepId} cannot run before its dependencies complete.`,
      );
    }
  }

  return steps.map((s) => {
    if (s.id !== stepId) return s;
    if (to === "running") {
      return { ...s, status: "running", startedAt: s.startedAt ?? now };
    }
    if (to === "completed") {
      const { error: _error, ...rest } = s;
      return {
        ...rest,
        status: "completed",
        startedAt: s.startedAt ?? now,
        completedAt: now,
        ...(outcome.output !== undefined ? { output: outcome.output } : {}),
      };
    }
    // failed
    const { output: _output, ...rest } = s;
    return {
      ...rest,
      status: "failed",
      startedAt: s.startedAt ?? now,
      completedAt: now,
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    };
  });
}

// Selective retry (spec §4b): reset the failed step and its transitive
// dependents back to pending; leave everything else (incl. unrelated
// completed steps) untouched.
export function resetFailedStep(steps: readonly TaskStep[], stepId: TaskStepId): TaskStep[] {
  const target = requireStep(steps, stepId);
  if (target.status !== "failed") {
    throw new TaskTransitionError(
      "task_step_not_failed",
      `Task step is not failed (cannot retry): ${stepId}`,
    );
  }

  const toReset = new Set<TaskStepId>([stepId]);
  const visited = new Set<TaskStepId>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of steps) {
      if (visited.has(s.id)) continue;
      if (s.dependsOn.some((dep) => toReset.has(dep))) {
        if (!toReset.has(s.id)) {
          toReset.add(s.id);
          changed = true;
        }
        visited.add(s.id);
      }
    }
  }

  return steps.map((s) => {
    if (!toReset.has(s.id)) return s;
    const { output: _o, error: _e, ...rest } = s;
    return { ...rest, status: "pending", startedAt: null, completedAt: null };
  });
}

export function readySteps(steps: readonly TaskStep[]): TaskStepId[] {
  return steps
    .filter(
      (s) =>
        s.status === "pending" &&
        s.dependsOn.every((dep) => steps.find((x) => x.id === dep)?.status === "completed"),
    )
    .map((s) => s.id);
}
```

> Note: the `TaskTransitionError(code, …)` argument is typed as `CoreRegistryErrorCode`, so a typo in a code is a compile error once Task 2's codes exist. The visited-set in `resetFailedStep` makes the transitive walk cycle-safe (a cyclic hand-built plan terminates rather than hanging).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test task-plan-transitions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/task-plan-transitions.ts packages/core/test/task-plan-transitions.test.ts
git commit -m "feat(core): pure task-plan state-machine transitions"
```

---

## Task 5: Store helpers — task-plans JSONL

**Files:**
- Modify: `packages/core/src/json-directory-store.ts`
- Test: `packages/core/test/task-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TaskPlan } from "../src/task-plan.js";
import {
  readAllTaskPlans,
  readTaskPlansForProject,
  resolveStorePaths,
  writeTaskPlansForProject,
} from "../src/json-directory-store.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const TS = "2026-06-12T00:00:00.000Z";

const plan: TaskPlan = {
  id: "d0000000-0000-4000-8000-000000000001",
  projectId: PROJECT_ID,
  sessionId: null,
  task: "fix login",
  status: "planned",
  steps: [
    {
      id: "d0000000-0000-4000-8000-00000000000a",
      type: "edit",
      title: "edit",
      dependsOn: [],
      status: "pending",
      startedAt: null,
      completedAt: null,
    },
  ],
  createdAt: TS,
  updatedAt: TS,
} as TaskPlan;

describe("task-plans store", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "task-store-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("round-trips plans per project and reads all", () => {
    const paths = resolveStorePaths(root);
    writeTaskPlansForProject(paths, PROJECT_ID, [plan]);
    expect(readTaskPlansForProject(paths, PROJECT_ID).map((p) => p.id)).toEqual([plan.id]);
    expect(readAllTaskPlans(paths).map((p) => p.id)).toEqual([plan.id]);
  });

  it("removes the file when the set is empty", () => {
    const paths = resolveStorePaths(root);
    writeTaskPlansForProject(paths, PROJECT_ID, [plan]);
    writeTaskPlansForProject(paths, PROJECT_ID, []);
    expect(readTaskPlansForProject(paths, PROJECT_ID)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test task-store`
Expected: FAIL — helpers missing.

- [ ] **Step 3a: Add `taskPlansDir` to `StorePaths` and both return objects**

In `packages/core/src/json-directory-store.ts`, add to the `StorePaths` type:

```ts
  taskPlansDir: string;
```

and add `taskPlansDir: join(resolvedRootDir, "task-plans"),` to **both** returned objects in `resolveStorePaths` (the ENOENT early-return branch and the final return), alongside `failedAttemptsDir`.

- [ ] **Step 3b: Add the import** (extend the existing import block)

```ts
import { type TaskPlan, taskPlanSchema } from "./task-plan.js";
```

- [ ] **Step 3c: Add the read/write helpers** (after the failed-attempts helpers, mirroring them exactly)

```ts
export function readTaskPlansForProject(paths: StorePaths, projectId: ProjectId): TaskPlan[] {
  const filePath = join(paths.taskPlansDir, `${projectId}.jsonl`);
  return readJsonLines(filePath).map((entry) => parseEntity(taskPlanSchema, entry, filePath));
}

export function readAllTaskPlans(paths: StorePaths): TaskPlan[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(paths.taskPlansDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw new CorePersistenceError("store_read_failed", "Store read failed.", {
      filePath: paths.taskPlansDir,
      cause: error,
    });
  }

  return fileNames
    .filter((fileName) => fileName.endsWith(".jsonl"))
    .flatMap((fileName) => {
      const filePath = join(paths.taskPlansDir, fileName);
      return readJsonLines(filePath).map((entry) => parseEntity(taskPlanSchema, entry, filePath));
    });
}

export function writeTaskPlansForProject(
  paths: StorePaths,
  projectId: ProjectId,
  plans: readonly TaskPlan[],
): void {
  const filePath = join(paths.taskPlansDir, `${projectId}.jsonl`);
  if (plans.length === 0) {
    removeIfExists(filePath);
    return;
  }
  atomicWriteFile(filePath, `${plans.map((p) => JSON.stringify(p)).join("\n")}\n`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test task-store`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/json-directory-store.ts packages/core/test/task-store.test.ts
git commit -m "feat(core): task-plans JSONL store helpers"
```

---

## Task 6: Registry methods (interface + both impls)

**Files:**
- Modify: `packages/core/src/registry.ts` (interface + in-memory)
- Modify: `packages/core/src/json-directory-registry.ts` (json)
- Test: `packages/core/test/registry-task.test.ts`

> One task: the interface change forces both impls to compile together.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema, taskPlanIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const TS = "2026-06-12T00:00:00.000Z";
const project = {
  id: PROJECT_ID,
  name: "demo",
  rootPath: "/tmp/demo",
  createdAt: TS,
  updatedAt: TS,
} as const;

// Deterministic id source: plan id first, then step ids in array order.
function clockFrom(ids: string[]) {
  let i = 0;
  return { now: () => TS, newId: () => ids[i++] ?? `x${i}` };
}
const PLAN_ID = "d0000000-0000-4000-8000-000000000001";
const STEP_A = "d0000000-0000-4000-8000-00000000000a";
const STEP_B = "d0000000-0000-4000-8000-00000000000b";

const input = {
  task: "fix login bug",
  sessionId: null,
  steps: [
    { type: "edit", title: "edit auth", key: "a" },
    { type: "debug", title: "debug auth", key: "b", dependsOnKeys: ["a"] },
  ],
} as const;

function suite(name: string, make: () => CoreRegistry) {
  describe(`${name}: task registry`, () => {
    it("createTaskPlan mints ids, resolves keys -> dependsOn, seeds pending/planned", () => {
      const r = make();
      r.createProject(project);
      const plan = r.createTaskPlan(PROJECT_ID, input, clockFrom([PLAN_ID, STEP_A, STEP_B]));
      expect(plan.id).toBe(PLAN_ID);
      expect(plan.status).toBe("planned");
      expect(plan.steps.map((s) => s.id)).toEqual([STEP_A, STEP_B]);
      expect(plan.steps[1]?.dependsOn).toEqual([STEP_A]);
      expect(plan.steps.every((s) => s.status === "pending")).toBe(true);
    });

    it("createTaskPlan throws on unknown project", () => {
      const r = make();
      expect(() => r.createTaskPlan(PROJECT_ID, input, clockFrom([PLAN_ID, STEP_A, STEP_B]))).toThrowError(
        /project_not_found|does not exist/,
      );
    });

    it("getTaskPlan / listTaskPlans are project-scoped", () => {
      const r = make();
      r.createProject(project);
      r.createTaskPlan(PROJECT_ID, input, clockFrom([PLAN_ID, STEP_A, STEP_B]));
      expect(r.getTaskPlan(taskPlanIdSchema.parse(PLAN_ID))?.id).toBe(PLAN_ID);
      expect(r.listTaskPlans(PROJECT_ID).map((p) => p.id)).toEqual([PLAN_ID]);
    });

    it("recordTaskStep advances a step and rolls up plan status", () => {
      const r = make();
      r.createProject(project);
      r.createTaskPlan(PROJECT_ID, input, clockFrom([PLAN_ID, STEP_A, STEP_B]));
      const planId = taskPlanIdSchema.parse(PLAN_ID);
      const running = r.recordTaskStep(planId, STEP_A as never, { status: "running" }, { now: () => TS });
      expect(running.status).toBe("running");
      const failed = r.recordTaskStep(planId, STEP_A as never, { status: "failed", error: "401" }, { now: () => TS });
      expect(failed.status).toBe("failed");
      expect(failed.steps[0]?.error).toBe("401");
    });

    it("recordTaskStep throws task_plan_not_found for an unknown plan", () => {
      const r = make();
      r.createProject(project);
      expect(() =>
        r.recordTaskStep(taskPlanIdSchema.parse(PLAN_ID), STEP_A as never, { status: "running" }, { now: () => TS }),
      ).toThrowError(/task_plan_not_found|does not exist/);
    });

    it("retryTaskStep resets the failed step + dependents, not the whole plan", () => {
      const r = make();
      r.createProject(project);
      r.createTaskPlan(PROJECT_ID, input, clockFrom([PLAN_ID, STEP_A, STEP_B]));
      const planId = taskPlanIdSchema.parse(PLAN_ID);
      r.recordTaskStep(planId, STEP_A as never, { status: "failed", error: "x" }, { now: () => TS });
      const retried = r.retryTaskStep(planId, STEP_A as never);
      expect(retried.steps[0]?.status).toBe("pending");
      expect(retried.steps[1]?.status).toBe("pending");
      expect(retried.status).toBe("planned");
    });

    it("retryTaskStep throws task_step_not_failed when the step is not failed", () => {
      const r = make();
      r.createProject(project);
      r.createTaskPlan(PROJECT_ID, input, clockFrom([PLAN_ID, STEP_A, STEP_B]));
      expect(() => r.retryTaskStep(taskPlanIdSchema.parse(PLAN_ID), STEP_A as never)).toThrowError(
        /task_step_not_failed|not failed/,
      );
    });
  });
}

suite("in-memory", () => createInMemoryCoreRegistry());

describe("json-directory", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "reg-p6-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  suite("json", () => createJsonDirectoryCoreRegistry({ rootDir: root }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test registry-task`
Expected: FAIL — methods not on `CoreRegistry`.

- [ ] **Step 3a: Extend the interface (`registry.ts`)**

Add imports (extend existing import block):

```ts
import {
  TaskTransitionError,
  type StepOutcome,
  applyStepOutcome,
  readySteps as readyStepIds,
  resetFailedStep,
  rollUpPlanStatus,
} from "./task-plan-transitions.js";
import {
  type TaskPlan,
  type TaskPlanInput,
  taskPlanInputSchema,
  taskPlanSchema,
  taskStepSchema,
} from "./task-plan.js";
```

Add `TaskPlanId`, `TaskStepId` to the `@megasaver/shared` type import:

```ts
import type {
  FailedAttemptId,
  MemoryEntryId,
  ProjectId,
  ProjectRuleId,
  SessionId,
  TaskPlanId,
  TaskStepId,
} from "@megasaver/shared";
```

Add the five interface methods (after `convertFailureToRule`):

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

- [ ] **Step 3b: Shared key-resolution helper (`registry.ts`, module scope, before `createInMemoryCoreRegistry`)**

```ts
// Resolve a caller-authored TaskPlanInput into a fully-formed TaskPlan: mint the
// plan id + one TaskStepId per local key, rewrite dependsOnKeys -> dependsOn,
// seed pending/planned. Shared verbatim by both registry impls so they stay
// behaviourally identical.
function buildTaskPlanFromInput(
  projectId: ProjectId,
  input: TaskPlanInput,
  clock: { now: () => string; newId: () => string },
): TaskPlan {
  const parsedInput = taskPlanInputSchema.parse(input);
  const keyToId = new Map<string, string>();
  for (const step of parsedInput.steps) {
    keyToId.set(step.key, clock.newId());
  }
  const steps = parsedInput.steps.map((step) =>
    taskStepSchema.parse({
      id: keyToId.get(step.key),
      type: step.type,
      title: step.title,
      dependsOn: step.dependsOnKeys.map((k) => keyToId.get(k)),
      status: "pending",
      startedAt: null,
      completedAt: null,
      ...(step.description !== undefined ? { description: step.description } : {}),
    }),
  );
  return taskPlanSchema.parse({
    id: clock.newId(),
    projectId,
    sessionId: parsedInput.sessionId,
    task: parsedInput.task,
    status: "planned",
    steps,
    createdAt: clock.now(),
    updatedAt: clock.now(),
  });
}
```

> Note: the plan id is minted **after** the step ids (the test's `clockFrom` array is `[planId, stepA, stepB]`, so mint order must be plan-first). Adjust: mint the plan id first. Use this corrected body — mint `planId` before the step loop:
>
> ```ts
>   const parsedInput = taskPlanInputSchema.parse(input);
>   const planId = clock.newId();
>   const keyToId = new Map<string, string>();
>   for (const step of parsedInput.steps) keyToId.set(step.key, clock.newId());
>   const steps = parsedInput.steps.map((step) => taskStepSchema.parse({ ... }));
>   return taskPlanSchema.parse({ id: planId, projectId, ... });
> ```

- [ ] **Step 3c: In-memory impl (`registry.ts`, after `convertFailureToRule`)**

Add a `taskPlans` map next to the others at the top of `createInMemoryCoreRegistry`:

```ts
  const taskPlans = new Map<TaskPlanId, TaskPlan>();
```

Add the methods:

```ts
    createTaskPlan(projectId, input, clock) {
      requireProject(projectId);
      const plan = buildTaskPlanFromInput(projectId, input, clock);
      if (plan.sessionId !== null) {
        const session = sessions.get(plan.sessionId);
        if (!session) {
          throw new CoreRegistryError(
            "session_not_found",
            `Session does not exist: ${plan.sessionId}`,
          );
        }
        if (session.projectId !== projectId) {
          throw new CoreRegistryError(
            "session_project_mismatch",
            `Session ${plan.sessionId} does not belong to project ${projectId}`,
          );
        }
      }
      if (taskPlans.has(plan.id)) {
        throw new CoreRegistryError("task_plan_already_exists", `Task plan already exists: ${plan.id}`);
      }
      taskPlans.set(plan.id, plan);
      return taskPlanSchema.parse(plan);
    },

    getTaskPlan(id) {
      const plan = taskPlans.get(id);
      return plan ? taskPlanSchema.parse(plan) : null;
    },

    listTaskPlans(projectId) {
      requireProject(projectId);
      return Array.from(taskPlans.values())
        .filter((p) => p.projectId === projectId)
        .map((p) => taskPlanSchema.parse(p));
    },

    recordTaskStep(planId, stepId, outcome, clock) {
      const existing = taskPlans.get(planId);
      if (!existing) {
        throw new CoreRegistryError("task_plan_not_found", `Task plan does not exist: ${planId}`);
      }
      const updated = applyTaskStepRecord(existing, stepId, outcome, clock.now());
      taskPlans.set(planId, updated);
      return updated;
    },

    retryTaskStep(planId, stepId) {
      const existing = taskPlans.get(planId);
      if (!existing) {
        throw new CoreRegistryError("task_plan_not_found", `Task plan does not exist: ${planId}`);
      }
      const updated = applyTaskStepRetry(existing, stepId);
      taskPlans.set(planId, updated);
      return updated;
    },
```

- [ ] **Step 3d: Two shared mutation helpers (`registry.ts`, module scope)**

These wrap the pure transitions, re-throw `TaskTransitionError` as `CoreRegistryError`, re-parse the plan, and bump `updatedAt`. Both impls call them so behaviour is identical.

```ts
function applyTaskStepRecord(
  plan: TaskPlan,
  stepId: TaskStepId,
  outcome: StepOutcome,
  now: string,
): TaskPlan {
  let steps;
  try {
    steps = applyStepOutcome(plan.steps, stepId, outcome, now);
  } catch (err) {
    if (err instanceof TaskTransitionError) throw new CoreRegistryError(err.code, err.message);
    throw err;
  }
  return taskPlanSchema.parse({
    ...plan,
    steps,
    status: rollUpPlanStatus(steps),
    updatedAt: now,
  });
}

function applyTaskStepRetry(plan: TaskPlan, stepId: TaskStepId): TaskPlan {
  let steps;
  try {
    steps = resetFailedStep(plan.steps, stepId);
  } catch (err) {
    if (err instanceof TaskTransitionError) throw new CoreRegistryError(err.code, err.message);
    throw err;
  }
  return taskPlanSchema.parse({ ...plan, steps, status: rollUpPlanStatus(steps) });
}
```

> `retryTaskStep` does not change `updatedAt` time injection (no clock passed per interface); it leaves `updatedAt` as-is. If a fresh timestamp is wanted, the interface would carry a clock — kept minimal here per spec §2 (retry has no clock param). `readyStepIds` is imported but used only by MCP/CLI later; if biome flags an unused import in `registry.ts`, drop it from this file's import and import it directly where used (Task 8/CLI). Prefer importing `readySteps` only where consumed.

- [ ] **Step 3e: Json impl (`json-directory-registry.ts`)**

Add imports (extend existing blocks):

```ts
import type { TaskPlanId, TaskStepId } from "@megasaver/shared";
import {
  readAllTaskPlans,
  readTaskPlansForProject,
  writeTaskPlansForProject,
} from "./json-directory-store.js";
import { type TaskPlanInput, taskPlanSchema } from "./task-plan.js";
import type { StepOutcome } from "./task-plan-transitions.js";
```

> The two shared helpers `buildTaskPlanFromInput`, `applyTaskStepRecord`, `applyTaskStepRetry` live in `registry.ts`. Export them from `registry.ts` (`export function buildTaskPlanFromInput…` etc.) and import them here:
>
> ```ts
> import { buildTaskPlanFromInput, applyTaskStepRecord, applyTaskStepRetry } from "./registry.js";
> ```
>
> (They are pure and store-agnostic, so sharing them keeps the two impls byte-identical in behaviour.)

Add the methods (after `convertFailureToRule`). **Critical:** all store reads/writes INLINE under one `withDirLock`; never call a public lock-taking method inside the lock.

```ts
    createTaskPlan(projectId, input, clock) {
      return withDirLock(options.rootDir, () => {
        requireProject(projectId);
        const plan = buildTaskPlanFromInput(projectId, input, clock);
        if (plan.sessionId !== null) {
          const session = readSessions(paths).find((s) => s.id === plan.sessionId);
          if (!session) {
            throw new CoreRegistryError(
              "session_not_found",
              `Session does not exist: ${plan.sessionId}`,
            );
          }
          if (session.projectId !== projectId) {
            throw new CoreRegistryError(
              "session_project_mismatch",
              `Session ${plan.sessionId} does not belong to project ${projectId}`,
            );
          }
        }
        if (readAllTaskPlans(paths).some((p) => p.id === plan.id)) {
          throw new CoreRegistryError(
            "task_plan_already_exists",
            `Task plan already exists: ${plan.id}`,
          );
        }
        writeTaskPlansForProject(paths, projectId, [
          ...readTaskPlansForProject(paths, projectId),
          plan,
        ]);
        return taskPlanSchema.parse(plan);
      });
    },

    getTaskPlan(id) {
      const plan = readAllTaskPlans(paths).find((p) => p.id === id);
      return plan ? taskPlanSchema.parse(plan) : null;
    },

    listTaskPlans(projectId) {
      requireProject(projectId);
      return readTaskPlansForProject(paths, projectId).map((p) => taskPlanSchema.parse(p));
    },

    recordTaskStep(planId, stepId, outcome, clock) {
      return withDirLock(options.rootDir, () => {
        const existing = readAllTaskPlans(paths).find((p) => p.id === planId);
        if (!existing) {
          throw new CoreRegistryError("task_plan_not_found", `Task plan does not exist: ${planId}`);
        }
        const updated = applyTaskStepRecord(existing, stepId, outcome, clock.now());
        const next = readTaskPlansForProject(paths, existing.projectId).map((p) =>
          p.id === planId ? updated : p,
        );
        writeTaskPlansForProject(paths, existing.projectId, next);
        return updated;
      });
    },

    retryTaskStep(planId, stepId) {
      return withDirLock(options.rootDir, () => {
        const existing = readAllTaskPlans(paths).find((p) => p.id === planId);
        if (!existing) {
          throw new CoreRegistryError("task_plan_not_found", `Task plan does not exist: ${planId}`);
        }
        const updated = applyTaskStepRetry(existing, stepId);
        const next = readTaskPlansForProject(paths, existing.projectId).map((p) =>
          p.id === planId ? updated : p,
        );
        writeTaskPlansForProject(paths, existing.projectId, next);
        return updated;
      });
    },
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @megasaver/core test registry-task && pnpm --filter @megasaver/core typecheck`
Expected: PASS (14 tests: 7 × in-memory + 7 × json); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/registry.ts packages/core/src/json-directory-registry.ts packages/core/test/registry-task.test.ts
git commit -m "feat(core): createTaskPlan + record/retry/get/list task plan (both impls)"
```

---

## Task 7: Core barrel exports

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/index-task.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("core barrel (phase 6)", () => {
  it("re-exports the task-engine surface", () => {
    expect(core.taskPlanSchema).toBeDefined();
    expect(core.taskPlanInputSchema).toBeDefined();
    expect(core.taskStepTypeSchema).toBeDefined();
    expect(core.rollUpPlanStatus).toBeDefined();
    expect(core.applyStepOutcome).toBeDefined();
    expect(core.resetFailedStep).toBeDefined();
    expect(core.readySteps).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test index-task`
Expected: FAIL.

- [ ] **Step 3: Add exports** to `packages/core/src/index.ts`

```ts
export * from "./task-plan.js";
export * from "./task-plan-transitions.js";
```

- [ ] **Step 4: Run test + build core**

Run: `pnpm --filter @megasaver/core test index-task && pnpm --filter @megasaver/core build`
Expected: PASS; build clean (so downstream mcp-bridge/cli tests resolve `@megasaver/core`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/index-task.test.ts
git commit -m "feat(core): export task-engine modules from barrel"
```

---

## Task 8: MCP tool — build_task_plan

**Files:**
- Create: `packages/mcp-bridge/src/tools/build-task-plan.ts`
- Test: `packages/mcp-bridge/test/tools/task-tools.test.ts` (created here; extended in Tasks 9–11)

- [ ] **Step 1: Write the failing test**

```ts
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { handleBuildTaskPlan } from "../../src/tools/build-task-plan.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-12T00:00:00.000Z";

function seeded(): CoreRegistry {
  const r = createInMemoryCoreRegistry();
  r.createProject({ id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS });
  return r;
}
function ids(list: string[]) {
  let i = 0;
  return { now: () => TS, newId: () => list[i++] ?? `x${i}` };
}
const PLAN_ID = "d0000000-0000-4000-8000-000000000001";
const STEP_A = "d0000000-0000-4000-8000-00000000000a";
const STEP_B = "d0000000-0000-4000-8000-00000000000b";

describe("build_task_plan", () => {
  it("creates a plan with resolved dependencies", async () => {
    const r = seeded();
    const env = { registry: r, ...ids([PLAN_ID, STEP_A, STEP_B]) };
    const res = await handleBuildTaskPlan(env, {
      projectId: PROJECT_ID,
      task: "fix login",
      steps: [
        { type: "edit", title: "edit", key: "a" },
        { type: "debug", title: "debug", key: "b", dependsOnKeys: ["a"] },
      ],
    });
    expect(res.plan.id).toBe(PLAN_ID);
    expect(res.plan.steps[1]?.dependsOn).toEqual([STEP_A]);
  });
  it("rejects an unknown project as resource_not_found", async () => {
    const env = { registry: seeded(), ...ids([PLAN_ID, STEP_A]) };
    await expect(
      handleBuildTaskPlan(env, {
        projectId: "99999999-9999-4999-8999-999999999999",
        task: "t",
        steps: [{ type: "edit", title: "x", key: "a" }],
      }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
  it("rejects invalid input as validation_failed", async () => {
    const env = { registry: seeded(), ...ids([PLAN_ID]) };
    await expect(
      handleBuildTaskPlan(env, { projectId: PROJECT_ID, task: "t", steps: [] }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test task-tools`
Expected: FAIL — module missing. (Build core first if needed.)

- [ ] **Step 3: Write the handler**

```ts
import {
  type CoreRegistry,
  CoreRegistryError,
  type TaskPlan,
  taskPlanInputSchema,
} from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type BuildTaskPlanEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
};

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().min(1),
    sessionId: z.string().min(1).nullable().optional(),
    steps: z
      .array(
        z
          .object({
            type: z.string().min(1),
            title: z.string().min(1),
            description: z.string().min(1).optional(),
            key: z.string().min(1),
            dependsOnKeys: z.array(z.string().min(1)).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type BuildTaskPlanResult = { plan: TaskPlan };

function mapCoreError(err: unknown): McpBridgeError {
  if (err instanceof CoreRegistryError) {
    if (err.code === "project_not_found" || err.code === "session_not_found") {
      return new McpBridgeError("resource_not_found", err.message);
    }
    return new McpBridgeError("validation_failed", err.message);
  }
  if (err instanceof Error) return new McpBridgeError("validation_failed", err.message);
  return new McpBridgeError("validation_failed", "build_task_plan failed");
}

export async function handleBuildTaskPlan(
  env: BuildTaskPlanEnv,
  rawArgs: unknown,
): Promise<BuildTaskPlanResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const d = parsed.data;
  // Re-parse the steps through Core's input schema so enum/refine errors map
  // to validation_failed here, not deep in the registry.
  const planInput = taskPlanInputSchema.safeParse({
    task: d.task,
    sessionId: d.sessionId ?? null,
    steps: d.steps.map((s) => ({
      type: s.type,
      title: s.title,
      key: s.key,
      ...(s.description !== undefined ? { description: s.description } : {}),
      ...(s.dependsOnKeys !== undefined ? { dependsOnKeys: s.dependsOnKeys } : {}),
    })),
  });
  if (!planInput.success) {
    throw new McpBridgeError("validation_failed", planInput.error.message);
  }
  try {
    const plan = env.registry.createTaskPlan(d.projectId as ProjectId, planInput.data, {
      now: env.now,
      newId: env.newId,
    });
    return { plan };
  } catch (err) {
    throw mapCoreError(err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test task-tools`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tools/build-task-plan.ts packages/mcp-bridge/test/tools/task-tools.test.ts
git commit -m "feat(mcp-bridge): build_task_plan tool"
```

---

## Task 9: MCP tool — get_task_status

**Files:**
- Create: `packages/mcp-bridge/src/tools/get-task-status.ts`
- Modify: `packages/mcp-bridge/test/tools/task-tools.test.ts` (append)

- [ ] **Step 1: Append the failing test**

Add import at top of `task-tools.test.ts`:

```ts
import { handleGetTaskStatus } from "../../src/tools/get-task-status.js";
```

Append:

```ts
describe("get_task_status", () => {
  async function withPlan() {
    const r = seeded();
    const env = { registry: r, ...ids([PLAN_ID, STEP_A, STEP_B]) };
    await handleBuildTaskPlan(env, {
      projectId: PROJECT_ID,
      task: "fix login",
      steps: [
        { type: "edit", title: "edit", key: "a" },
        { type: "debug", title: "debug", key: "b", dependsOnKeys: ["a"] },
      ],
    });
    return r;
  }
  it("returns the plan and the ready step ids", async () => {
    const r = await withPlan();
    const res = await handleGetTaskStatus({ registry: r }, { planId: PLAN_ID });
    expect(res.plan.id).toBe(PLAN_ID);
    expect(res.ready).toEqual([STEP_A]); // b is blocked on a
  });
  it("rejects an unknown plan as resource_not_found", async () => {
    const r = seeded();
    await expect(handleGetTaskStatus({ registry: r }, { planId: PLAN_ID })).rejects.toMatchObject({
      code: "resource_not_found",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test task-tools`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the handler**

```ts
import { type CoreRegistry, type TaskPlan, readySteps } from "@megasaver/core";
import { taskPlanIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type GetTaskStatusEnv = { registry: CoreRegistry };

const inputSchema = z.object({ planId: z.string().min(1) }).strict();

export type GetTaskStatusResult = { plan: TaskPlan; ready: readonly string[] };

export async function handleGetTaskStatus(
  env: GetTaskStatusEnv,
  rawArgs: unknown,
): Promise<GetTaskStatusResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const planId = taskPlanIdSchema.safeParse(parsed.data.planId);
  if (!planId.success) {
    throw new McpBridgeError("validation_failed", `invalid planId: ${parsed.data.planId}`);
  }
  const plan = env.registry.getTaskPlan(planId.data);
  if (!plan) {
    throw new McpBridgeError("resource_not_found", `Task plan does not exist: ${parsed.data.planId}`);
  }
  return { plan, ready: readySteps(plan.steps) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test task-tools`
Expected: PASS (3 prior + 2 new = 5).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tools/get-task-status.ts packages/mcp-bridge/test/tools/task-tools.test.ts
git commit -m "feat(mcp-bridge): get_task_status tool"
```

---

## Task 10: MCP tool — record_task_step (+ opt-in FailedAttempt)

**Files:**
- Create: `packages/mcp-bridge/src/tools/record-task-step.ts`
- Modify: `packages/mcp-bridge/test/tools/task-tools.test.ts` (append)

- [ ] **Step 1: Append the failing test**

Add import:

```ts
import { handleRecordTaskStep } from "../../src/tools/record-task-step.js";
```

Append:

```ts
describe("record_task_step", () => {
  async function withPlan() {
    const r = seeded();
    await handleBuildTaskPlan(
      { registry: r, ...ids([PLAN_ID, STEP_A, STEP_B]) },
      {
        projectId: PROJECT_ID,
        task: "fix login",
        steps: [
          { type: "edit", title: "edit", key: "a" },
          { type: "debug", title: "debug", key: "b", dependsOnKeys: ["a"] },
        ],
      },
    );
    return r;
  }
  const env = (r: CoreRegistry) => ({ registry: r, now: () => TS, newId: () => "f0000000-0000-4000-8000-000000000001" });

  it("advances a step and rolls up status", async () => {
    const r = await withPlan();
    const res = await handleRecordTaskStep(env(r), { planId: PLAN_ID, stepId: STEP_A, status: "running" });
    expect(res.plan.status).toBe("running");
  });
  it("records a FailedAttempt when recordFailure is set on a failed step", async () => {
    const r = await withPlan();
    await handleRecordTaskStep(env(r), {
      planId: PLAN_ID,
      stepId: STEP_A,
      status: "failed",
      error: "401",
      recordFailure: true,
    });
    expect(r.listFailedAttempts(PROJECT_ID as never)).toHaveLength(1);
  });
  it("rejects an illegal transition as validation_failed", async () => {
    const r = await withPlan();
    await handleRecordTaskStep(env(r), { planId: PLAN_ID, stepId: STEP_A, status: "completed" });
    await expect(
      handleRecordTaskStep(env(r), { planId: PLAN_ID, stepId: STEP_A, status: "running" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
  it("rejects an unknown plan as resource_not_found", async () => {
    const r = seeded();
    await expect(
      handleRecordTaskStep(env(r), { planId: PLAN_ID, stepId: STEP_A, status: "running" }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test task-tools`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the handler**

```ts
import {
  type CoreRegistry,
  CoreRegistryError,
  type StepOutcome,
  type TaskPlan,
  failedAttemptSchema,
} from "@megasaver/core";
import { taskPlanIdSchema, taskStepIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type RecordTaskStepEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
};

const inputSchema = z
  .object({
    planId: z.string().min(1),
    stepId: z.string().min(1),
    status: z.enum(["running", "completed", "failed"]),
    output: z.string().min(1).optional(),
    error: z.string().min(1).optional(),
    recordFailure: z.boolean().optional(),
  })
  .strict();

export type RecordTaskStepResult = { plan: TaskPlan };

function mapCoreError(err: unknown): McpBridgeError {
  if (err instanceof CoreRegistryError) {
    if (err.code === "task_plan_not_found") {
      return new McpBridgeError("resource_not_found", err.message);
    }
    // task_step_not_found, task_step_transition_invalid, task_step_dependency_unmet
    return new McpBridgeError("validation_failed", err.message);
  }
  if (err instanceof Error) return new McpBridgeError("validation_failed", err.message);
  return new McpBridgeError("validation_failed", "record_task_step failed");
}

export async function handleRecordTaskStep(
  env: RecordTaskStepEnv,
  rawArgs: unknown,
): Promise<RecordTaskStepResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const d = parsed.data;
  const planId = taskPlanIdSchema.safeParse(d.planId);
  const stepId = taskStepIdSchema.safeParse(d.stepId);
  if (!planId.success || !stepId.success) {
    throw new McpBridgeError("validation_failed", "invalid planId or stepId");
  }

  const outcome: StepOutcome =
    d.status === "running"
      ? { status: "running" }
      : d.status === "completed"
        ? { status: "completed", ...(d.output !== undefined ? { output: d.output } : {}) }
        : { status: "failed", ...(d.error !== undefined ? { error: d.error } : {}) };

  let plan: TaskPlan;
  try {
    plan = env.registry.recordTaskStep(planId.data, stepId.data, outcome, { now: env.now });
  } catch (err) {
    throw mapCoreError(err);
  }

  // Opt-in Phase 5 reuse, OUTSIDE any registry lock (the registry call has
  // returned). Mirrors record_failed_attempt: build + createFailedAttempt.
  if (d.status === "failed" && d.recordFailure === true) {
    const step = plan.steps.find((s) => s.id === stepId.data);
    const attempt = failedAttemptSchema.parse({
      id: env.newId(),
      projectId: plan.projectId,
      sessionId: plan.sessionId,
      task: plan.task,
      failedStep: step?.title ?? "task step",
      relatedFiles: [],
      convertedToRule: false,
      createdAt: env.now(),
      ...(d.error !== undefined ? { errorOutput: d.error } : {}),
    });
    env.registry.createFailedAttempt(attempt);
  }

  return { plan };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test task-tools`
Expected: PASS (5 prior + 4 new = 9).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tools/record-task-step.ts packages/mcp-bridge/test/tools/task-tools.test.ts
git commit -m "feat(mcp-bridge): record_task_step tool with opt-in FailedAttempt"
```

---

## Task 11: MCP tool — retry_failed_step

**Files:**
- Create: `packages/mcp-bridge/src/tools/retry-failed-step.ts`
- Modify: `packages/mcp-bridge/test/tools/task-tools.test.ts` (append)

- [ ] **Step 1: Append the failing test**

Add import:

```ts
import { handleRetryFailedStep } from "../../src/tools/retry-failed-step.js";
```

Append:

```ts
describe("retry_failed_step", () => {
  async function failedPlan() {
    const r = seeded();
    const env = { registry: r, now: () => TS, newId: () => "f0000000-0000-4000-8000-000000000001" };
    await handleBuildTaskPlan(
      { registry: r, ...ids([PLAN_ID, STEP_A, STEP_B]) },
      {
        projectId: PROJECT_ID,
        task: "fix login",
        steps: [
          { type: "edit", title: "edit", key: "a" },
          { type: "debug", title: "debug", key: "b", dependsOnKeys: ["a"] },
        ],
      },
    );
    await handleRecordTaskStep(env, { planId: PLAN_ID, stepId: STEP_A, status: "failed", error: "x" });
    return r;
  }
  it("resets the failed step + dependent and returns the plan", async () => {
    const r = await failedPlan();
    const res = await handleRetryFailedStep({ registry: r }, { planId: PLAN_ID, stepId: STEP_A });
    expect(res.plan.steps[0]?.status).toBe("pending");
    expect(res.plan.steps[1]?.status).toBe("pending");
    expect(res.plan.status).toBe("planned");
  });
  it("rejects a non-failed step as validation_failed", async () => {
    const r = await failedPlan();
    await handleRetryFailedStep({ registry: r }, { planId: PLAN_ID, stepId: STEP_A });
    // STEP_A is now pending, not failed
    await expect(
      handleRetryFailedStep({ registry: r }, { planId: PLAN_ID, stepId: STEP_A }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
  it("rejects an unknown plan as resource_not_found", async () => {
    const r = seeded();
    await expect(
      handleRetryFailedStep({ registry: r }, { planId: PLAN_ID, stepId: STEP_A }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test task-tools`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the handler**

```ts
import { type CoreRegistry, CoreRegistryError, type TaskPlan } from "@megasaver/core";
import { taskPlanIdSchema, taskStepIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type RetryFailedStepEnv = { registry: CoreRegistry };

const inputSchema = z
  .object({ planId: z.string().min(1), stepId: z.string().min(1) })
  .strict();

export type RetryFailedStepResult = { plan: TaskPlan };

function mapCoreError(err: unknown): McpBridgeError {
  if (err instanceof CoreRegistryError) {
    if (err.code === "task_plan_not_found") {
      return new McpBridgeError("resource_not_found", err.message);
    }
    return new McpBridgeError("validation_failed", err.message);
  }
  if (err instanceof Error) return new McpBridgeError("validation_failed", err.message);
  return new McpBridgeError("validation_failed", "retry_failed_step failed");
}

export async function handleRetryFailedStep(
  env: RetryFailedStepEnv,
  rawArgs: unknown,
): Promise<RetryFailedStepResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const planId = taskPlanIdSchema.safeParse(parsed.data.planId);
  const stepId = taskStepIdSchema.safeParse(parsed.data.stepId);
  if (!planId.success || !stepId.success) {
    throw new McpBridgeError("validation_failed", "invalid planId or stepId");
  }
  try {
    const plan = env.registry.retryTaskStep(planId.data, stepId.data);
    return { plan };
  } catch (err) {
    throw mapCoreError(err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test task-tools`
Expected: PASS (9 prior + 3 new = 12).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tools/retry-failed-step.ts packages/mcp-bridge/test/tools/task-tools.test.ts
git commit -m "feat(mcp-bridge): retry_failed_step tool"
```

---

## Task 12: Wire 4 tools into the enum + server

**Files:**
- Modify: `packages/mcp-bridge/src/tool-name.ts`, `packages/mcp-bridge/test/tool-name.test-d.ts`
- Modify: `packages/mcp-bridge/src/server.ts`
- Test: `packages/mcp-bridge/test/tool-name-task.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { mcpToolNameSchema } from "../src/tool-name.js";

describe("tool-name enum (phase 6)", () => {
  it("is a closed set of 22 alphabetically-ordered names", () => {
    expect(mcpToolNameSchema.options).toEqual([
      "build_task_plan",
      "convert_failure_to_rule",
      "explain_context_selection",
      "find_similar_failures",
      "get_applicable_rules",
      "get_context_budget_report",
      "get_project_context",
      "get_project_rules",
      "get_relevant_code_blocks",
      "get_relevant_context",
      "get_relevant_memories",
      "get_task_status",
      "mega_fetch_chunk",
      "mega_read_file",
      "mega_recall",
      "mega_run_command",
      "record_failed_attempt",
      "record_task_step",
      "retry_failed_step",
      "save_memory",
      "save_project_rule",
      "search_memory",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test tool-name-task`
Expected: FAIL — 18 names.

- [ ] **Step 3a: Replace the enum (`tool-name.ts`)** with the 22-name list above (same order). Update the leading comment to mention the Phase 6 Task Engine tools (`build_task_plan`, `get_task_status`, `record_task_step`, `retry_failed_step`). Their alphabetic positions: `build_task_plan` first; `get_task_status` after `get_relevant_memories`; `record_task_step` after `record_failed_attempt`; `retry_failed_step` after `record_task_step`.

- [ ] **Step 3b: Update `test/tool-name.test-d.ts`** — the type-level tuple pinned to the member count. Add the 4 new names in their alphabetic positions so the tuple has 22 members matching the enum (same edit shape as the Phase 5 18-member change).

- [ ] **Step 3c: Import handlers in `server.ts`**

```ts
import { handleBuildTaskPlan } from "./tools/build-task-plan.js";
import { handleGetTaskStatus } from "./tools/get-task-status.js";
import { handleRecordTaskStep } from "./tools/record-task-step.js";
import { handleRetryFailedStep } from "./tools/retry-failed-step.js";
```

- [ ] **Step 3d: Add `TOOL_DEFS` rows** (keep alphabetic, matching the enum order)

```ts
  { name: "build_task_plan", description: "Create an ordered, dependency-aware task plan." },
```
(insert as the FIRST entry, before `convert_failure_to_rule`)

```ts
  { name: "get_task_status", description: "Plan status, per-step state, and ready steps." },
```
(insert after `get_relevant_memories`)

```ts
  { name: "record_task_step", description: "Report a step running/completed/failed; rolls up plan status." },
  { name: "retry_failed_step", description: "Reset a failed step (and its dependents) to pending." },
```
(insert after `record_failed_attempt`)

- [ ] **Step 3e: Add dispatch cases** in the `switch (toolName)`

```ts
      case "build_task_plan":
        return handleBuildTaskPlan({ registry: deps.registry, now, newId }, args);
      case "get_task_status":
        return handleGetTaskStatus({ registry: deps.registry }, args);
      case "record_task_step":
        return handleRecordTaskStep({ registry: deps.registry, now, newId }, args);
      case "retry_failed_step":
        return handleRetryFailedStep({ registry: deps.registry }, args);
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @megasaver/mcp-bridge test tool-name-task && pnpm --filter @megasaver/mcp-bridge typecheck`
Expected: PASS; typecheck clean (dispatch switch exhaustive over 22 names).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tool-name.ts packages/mcp-bridge/test/tool-name.test-d.ts packages/mcp-bridge/src/server.ts packages/mcp-bridge/test/tool-name-task.test.ts
git commit -m "feat(mcp-bridge): wire 4 Phase 6 task tools (18 -> 22)"
```

---

## Task 13: Server e2e — 22 tools + task round-trip

**Files:**
- Modify: `packages/mcp-bridge/test/server.e2e.test.ts`

- [ ] **Step 1: Append the failing test**

```ts
describe("phase 6 task tools over the bridge", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-e2e-p6-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-e2e-p6-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  // Deterministic id sequence: plan, stepA, stepB, then any later mint.
  function connectP6() {
    let i = 0;
    const ids = [
      "d0000000-0000-4000-8000-000000000001",
      "d0000000-0000-4000-8000-00000000000a",
      "d0000000-0000-4000-8000-00000000000b",
    ];
    const { server } = buildServer({
      registry: seededRegistry(projectRoot),
      storeRoot: store,
      now: () => TS,
      newId: () => ids[i++] ?? `e${i}`,
    });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    return Promise.all([server.connect(serverT), client.connect(clientT)]).then(() => ({
      client,
      server,
    }));
  }

  it("lists 22 tools", async () => {
    const { client, server } = await connect(projectRoot, store);
    const { tools } = (await client.listTools()) as { tools: { name: string }[] };
    expect(tools).toHaveLength(22);
    expect(tools.map((t) => t.name)).toContain("build_task_plan");
    await server.close();
  });

  it("build -> record(failed) -> retry -> record(completed) -> status round-trips", async () => {
    const { client, server } = await connectP6();
    const PLAN = "d0000000-0000-4000-8000-000000000001";
    const A = "d0000000-0000-4000-8000-00000000000a";

    await client.callTool({
      name: "build_task_plan",
      arguments: {
        projectId: PROJECT_ID,
        task: "fix login",
        steps: [
          { type: "edit", title: "edit auth", key: "a" },
          { type: "debug", title: "debug auth", key: "b", dependsOnKeys: ["a"] },
        ],
      },
    });
    await client.callTool({
      name: "record_task_step",
      arguments: { planId: PLAN, stepId: A, status: "failed", error: "401" },
    });
    await client.callTool({ name: "retry_failed_step", arguments: { planId: PLAN, stepId: A } });
    await client.callTool({
      name: "record_task_step",
      arguments: { planId: PLAN, stepId: A, status: "completed", output: "fixed" },
    });
    const statusRes = (await client.callTool({
      name: "get_task_status",
      arguments: { planId: PLAN },
    })) as { content: { text: string }[] };
    const payload = JSON.parse(statusRes.content[0]?.text ?? "{}") as {
      plan: { status: string };
      ready: string[];
    };
    expect(payload.plan.status).toBe("running"); // a completed, b now ready/running-eligible
    await server.close();
  });
});
```

> The shared `connect`/`seededRegistry`/`PROJECT_ID`/`TS` helpers already exist at the top of this file. `connectP6` is local because the round-trip mints entity ids via the server `newId`, which must be valid uuids in plan-then-steps order. After `a` completes and `b` is untouched-pending, plan rollup is `running` only if some step is running; if the assertion needs adjusting, assert `payload.ready` contains `b` and `payload.plan.steps` for `a` is `completed` instead — pick the assertion that matches the rollup rule (a completed + b pending with deps met → plan `planned`, `ready=[b]`). **Use the `ready`/per-step assertion** to avoid ambiguity:
> ```ts
> expect(payload.ready).toEqual([B]);
> ```
> with `const B = "d0000000-0000-4000-8000-00000000000b";`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test server.e2e`
Expected: FAIL on "lists 22 tools" until Task 12 landed; with Task 12 done, the round-trip exercises the new tools.

- [ ] **Step 3: (no production change)** — Task 12 wired the tools; this task is test-only. Finalize the round-trip assertion to the `ready=[B]` form noted above.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test server.e2e`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/test/server.e2e.test.ts
git commit -m "test(mcp-bridge): e2e 22-tool surface + task round-trip"
```

---

## Task 14: CLI — `mega task` shared + plan

**Files:**
- Create: `apps/cli/src/commands/task/{shared,plan}.ts`
- Test: `apps/cli/test/task.test.ts`

All leaves follow the `apps/cli/src/commands/fail/record.ts` pattern: a `run<Name>(input)` returning `Promise<0 | 1>` that resolves the store, looks up the project by name, calls the registry via injected `stdout`/`stderr`, plus a `defineCommand` wrapper. Reuse `mapErrorToCliMessage`/`projectNotFoundMessage` (`../../errors.js`), `ensureStoreReady`/`resolveStorePath`/`readStoreEnv` (`../../store.js`), `readTestEnv` (`../session/shared.js`), `projectNameSchema` (`../shared/schemas.js`).

- [ ] **Step 1: Write the failing test** (`apps/cli/test/task.test.ts`)

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTaskPlan } from "../src/commands/task/plan.js";
import { runTaskStep } from "../src/commands/task/step.js";
import { runTaskRetry } from "../src/commands/task/retry.js";
import { runTaskStatus } from "../src/commands/task/status.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const TS = "2026-06-12T00:00:00.000Z";
const PLAN_ID = "d0000000-0000-4000-8000-000000000001";

function base(root: string, out: string[], err: string[]) {
  return {
    projectName: "demo",
    storeFlag: root,
    cwd: root,
    home: root,
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
    now: () => TS,
  };
}

describe("mega task plan", () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cli-task-"));
    await initStore(root);
    createJsonDirectoryCoreRegistry({ rootDir: root }).createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: TS,
      updatedAt: TS,
    });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("creates a linear plan and prints the plan id", async () => {
    const out: string[] = [];
    const err: string[] = [];
    let i = 0;
    const ids = [PLAN_ID, "d0000000-0000-4000-8000-00000000000a", "d0000000-0000-4000-8000-00000000000b"];
    const code = await runTaskPlan({
      ...base(root, out, err),
      taskFlag: "fix login",
      stepFlags: ["edit:edit auth", "test:run tests"],
      newId: () => ids[i++] ?? `x${i}`,
    });
    expect(code).toBe(0);
    expect(out[0]).toBe(PLAN_ID);
  });
});
```

(The `step`/`retry`/`status` imports are used by Tasks 15–16 tests appended to this file; importing them now keeps the file's import block stable. If the test runner errors on a not-yet-created module, add these imports in Task 15 instead.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test task`
Expected: FAIL — modules missing. (Build core first if needed.)

- [ ] **Step 3a: `task/shared.ts`**

```ts
import type { TaskPlan, TaskStep } from "@megasaver/core";
import { taskPlanIdSchema, taskStepIdSchema } from "@megasaver/shared";

export { taskPlanIdSchema, taskStepIdSchema };

// Parse repeatable `--step "type:title"` flags into create-input steps with a
// linear dependency chain (step N dependsOn step N-1). A dependency-rich plan
// uses the MCP build_task_plan tool or a future --steps-json flag.
export function parseStepFlags(value: unknown): {
  type: string;
  title: string;
  key: string;
  dependsOnKeys: string[];
}[] {
  const raw = toStringArray(value);
  return raw.map((entry, i) => {
    const sep = entry.indexOf(":");
    const type = sep === -1 ? entry : entry.slice(0, sep);
    const title = sep === -1 ? entry : entry.slice(sep + 1);
    return {
      type: type.trim(),
      title: title.trim(),
      key: `s${i}`,
      dependsOnKeys: i === 0 ? [] : [`s${i - 1}`],
    };
  });
}

export function toStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

export function formatStepLine(s: Pick<TaskStep, "id" | "status" | "type" | "title">): string {
  return `${s.id}  ${s.status.padEnd(9, " ")}  ${s.type.padEnd(16, " ")}  ${s.title}`;
}

export function formatPlanStatus(plan: TaskPlan, ready: readonly string[]): string[] {
  return [
    `plan    ${plan.id}`,
    `task    ${plan.task}`,
    `status  ${plan.status}`,
    ...plan.steps.map(formatStepLine),
    `ready   ${ready.length > 0 ? ready.join(", ") : "-"}`,
  ];
}
```

- [ ] **Step 3b: `task/plan.ts`**

```ts
import { type TaskPlanInput, taskPlanInputSchema } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { projectNameSchema } from "../shared/schemas.js";
import { parseStepFlags } from "./shared.js";

export type RunTaskPlanInput = {
  projectName: string;
  taskFlag: string;
  stepFlags?: unknown;
  sessionFlag?: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  newId?: () => string;
  now?: () => string;
};

export async function runTaskPlan(input: RunTaskPlanInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const steps = parseStepFlags(input.stepFlags);
  if (steps.length === 0) {
    input.stderr("error: at least one --step is required");
    return 1;
  }
  const planInput = taskPlanInputSchema.safeParse({
    task: input.taskFlag,
    sessionId: null,
    steps,
  } satisfies Partial<TaskPlanInput> as TaskPlanInput);
  if (!planInput.success) {
    input.stderr(`error: invalid plan input: ${planInput.error.message}`);
    return 1;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    // Deterministic test override: a fixed plan id seeds the first mint.
    const fixed = readTestEnv("MEGA_TEST_TASK_PLAN_ID");
    let firstUsed = false;
    const mint = () => {
      if (fixed !== undefined && !firstUsed) {
        firstUsed = true;
        return fixed;
      }
      return newId();
    };
    const plan = registry.createTaskPlan(project.id, planInput.data, {
      now: () => readTestEnv("MEGA_TEST_NOW") ?? now(),
      newId: mint,
    });
    input.stdout(input.json ? JSON.stringify(plan) : plan.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const taskPlanCommand = defineCommand({
  meta: { name: "plan", description: "Create a task plan from ordered steps." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name (must exist)." },
    task: { type: "string", required: true, description: "The task being decomposed." },
    step: {
      type: "string",
      required: true,
      description: 'Step as "type:title" (repeatable; linear chain by order).',
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runTaskPlan({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      taskFlag: typeof args.task === "string" ? args.task : "",
      stepFlags: args.step,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

> Note on the test: it injects `newId` directly (mint order plan→stepA→stepB), so it does not rely on `MEGA_TEST_TASK_PLAN_ID`. The `MEGA_TEST_*` path is for the citty `run` wrapper where ids are not injectable. Keep both.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/cli test task -t "mega task plan"`
Expected: PASS (1 test). (The full `task` test file also references step/retry/status modules added in Tasks 15–16; scope this run to the plan test until those land, or move their imports to Task 15.)

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/task/shared.ts apps/cli/src/commands/task/plan.ts apps/cli/test/task.test.ts
git commit -m "feat(cli): mega task plan (linear-chain decomposition)"
```

---

## Task 15: CLI — `mega task step` + `mega task retry`

**Files:**
- Create: `apps/cli/src/commands/task/{step,retry}.ts`
- Modify: `apps/cli/test/task.test.ts` (append)

- [ ] **Step 1: Append the failing test**

```ts
describe("mega task step + retry", () => {
  let root: string;
  let stepA: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cli-task2-"));
    await initStore(root);
    const r = createJsonDirectoryCoreRegistry({ rootDir: root });
    r.createProject({ id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS });
    let i = 0;
    const ids = [PLAN_ID, "d0000000-0000-4000-8000-00000000000a", "d0000000-0000-4000-8000-00000000000b"];
    const plan = r.createTaskPlan(
      PROJECT_ID,
      {
        task: "fix login",
        sessionId: null,
        steps: [
          { type: "edit", title: "edit", key: "a" },
          { type: "debug", title: "debug", key: "b", dependsOnKeys: ["a"] },
        ],
      },
      { now: () => TS, newId: () => ids[i++] ?? `x${i}` },
    );
    stepA = plan.steps[0]!.id;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("marks a step failed (with --record-failure) then retry resets it", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const stepCode = await runTaskStep({
      ...base(root, out, err),
      planIdFlag: PLAN_ID,
      stepIdFlag: stepA,
      statusFlag: "failed",
      errorFlag: "401",
      recordFailure: true,
    });
    expect(stepCode).toBe(0);
    expect(createJsonDirectoryCoreRegistry({ rootDir: root }).listFailedAttempts(PROJECT_ID)).toHaveLength(1);

    const retryOut: string[] = [];
    const retryErr: string[] = [];
    const retryCode = await runTaskRetry({
      ...base(root, retryOut, retryErr),
      planIdFlag: PLAN_ID,
      stepIdFlag: stepA,
    });
    expect(retryCode).toBe(0);
    expect(retryOut.join("\n").toLowerCase()).toContain("planned");
  });

  it("retry of a non-failed step exits 1", async () => {
    const err: string[] = [];
    const code = await runTaskRetry({
      ...base(root, [], err),
      planIdFlag: PLAN_ID,
      stepIdFlag: stepA,
    });
    expect(code).toBe(1);
    expect(err.join("\n").toLowerCase()).toContain("not failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test task`
Expected: FAIL — `step.js` / `retry.js` missing.

- [ ] **Step 3a: `task/step.ts`**

```ts
import {
  type FailedAttempt,
  type StepOutcome,
  failedAttemptSchema,
} from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { taskPlanIdSchema, taskStepIdSchema } from "./shared.js";

export type RunTaskStepInput = {
  planIdFlag: string;
  stepIdFlag: string;
  statusFlag: string;
  outputFlag?: string | undefined;
  errorFlag?: string | undefined;
  recordFailure?: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  newId?: () => string;
  now?: () => string;
};

export async function runTaskStep(input: RunTaskStepInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let planId: ReturnType<typeof taskPlanIdSchema.parse>;
  let stepId: ReturnType<typeof taskStepIdSchema.parse>;
  try {
    planId = taskPlanIdSchema.parse(input.planIdFlag);
    stepId = taskStepIdSchema.parse(input.stepIdFlag);
  } catch {
    input.stderr("error: invalid plan or step id");
    return 1;
  }
  if (input.statusFlag !== "running" && input.statusFlag !== "completed" && input.statusFlag !== "failed") {
    input.stderr(`error: invalid status "${input.statusFlag}" (running | completed | failed)`);
    return 1;
  }
  const status = input.statusFlag;
  const outcome: StepOutcome =
    status === "running"
      ? { status: "running" }
      : status === "completed"
        ? { status: "completed", ...(input.outputFlag !== undefined ? { output: input.outputFlag } : {}) }
        : { status: "failed", ...(input.errorFlag !== undefined ? { error: input.errorFlag } : {}) };

  try {
    const { registry } = await ensureStoreReady(rootDir);
    const now = input.now ?? (() => new Date().toISOString());
    const ts = () => readTestEnv("MEGA_TEST_NOW") ?? now();
    const plan = registry.recordTaskStep(planId, stepId, outcome, { now: ts });

    if (status === "failed" && input.recordFailure === true) {
      const newId = input.newId ?? (() => crypto.randomUUID());
      const step = plan.steps.find((s) => s.id === stepId);
      const attempt: FailedAttempt = failedAttemptSchema.parse({
        id: readTestEnv("MEGA_TEST_FAILED_ATTEMPT_ID") ?? newId(),
        projectId: plan.projectId,
        sessionId: plan.sessionId,
        task: plan.task,
        failedStep: step?.title ?? "task step",
        relatedFiles: [],
        convertedToRule: false,
        createdAt: ts(),
        ...(input.errorFlag !== undefined ? { errorOutput: input.errorFlag } : {}),
      });
      registry.createFailedAttempt(attempt);
    }

    input.stdout(input.json ? JSON.stringify(plan) : `plan ${plan.status}; step ${stepId} ${status}`);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const taskStepCommand = defineCommand({
  meta: { name: "step", description: "Report a step running/completed/failed." },
  args: {
    planId: { type: "positional", required: true, description: "Task plan id (UUID)." },
    stepId: { type: "positional", required: true, description: "Task step id (UUID)." },
    status: { type: "string", required: true, description: "running | completed | failed." },
    output: { type: "string", description: "Step output (with --status completed)." },
    error: { type: "string", description: "Step error (with --status failed)." },
    "record-failure": {
      type: "boolean",
      default: false,
      description: "Also record a FailedAttempt (only with --status failed).",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runTaskStep({
      planIdFlag: typeof args.planId === "string" ? args.planId : "",
      stepIdFlag: typeof args.stepId === "string" ? args.stepId : "",
      statusFlag: typeof args.status === "string" ? args.status : "",
      outputFlag: typeof args.output === "string" ? args.output : undefined,
      errorFlag: typeof args.error === "string" ? args.error : undefined,
      recordFailure: !!args["record-failure"],
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 3b: `task/retry.ts`**

```ts
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { taskPlanIdSchema, taskStepIdSchema } from "./shared.js";

export type RunTaskRetryInput = {
  planIdFlag: string;
  stepIdFlag: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

export async function runTaskRetry(input: RunTaskRetryInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let planId: ReturnType<typeof taskPlanIdSchema.parse>;
  let stepId: ReturnType<typeof taskStepIdSchema.parse>;
  try {
    planId = taskPlanIdSchema.parse(input.planIdFlag);
    stepId = taskStepIdSchema.parse(input.stepIdFlag);
  } catch {
    input.stderr("error: invalid plan or step id");
    return 1;
  }
  try {
    const { registry } = await ensureStoreReady(rootDir);
    const before = registry.getTaskPlan(planId);
    const plan = registry.retryTaskStep(planId, stepId);
    // Report which steps changed to pending (the reset set).
    const reset = plan.steps
      .filter((s) => s.status === "pending" && before?.steps.find((b) => b.id === s.id)?.status !== "pending")
      .map((s) => s.id);
    if (input.json) {
      input.stdout(JSON.stringify({ planStatus: plan.status, reset }));
    } else {
      input.stdout(`plan ${plan.status}; reset ${reset.length > 0 ? reset.join(", ") : "-"}`);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const taskRetryCommand = defineCommand({
  meta: { name: "retry", description: "Selectively retry a failed step (resets it + dependents)." },
  args: {
    planId: { type: "positional", required: true, description: "Task plan id (UUID)." },
    stepId: { type: "positional", required: true, description: "Failed task step id (UUID)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runTaskRetry({
      planIdFlag: typeof args.planId === "string" ? args.planId : "",
      stepIdFlag: typeof args.stepId === "string" ? args.stepId : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

> The `task_step_not_failed` CoreRegistryError is rendered by the generic `mapErrorToCliMessage` `memory_create` branch as `error: task_step_not_failed: …`, which contains "not failed" — the test asserts that substring. Same generic mapping the `fail`/`rules` commands rely on; no new CLI error helper.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/cli test task`
Expected: PASS (plan test + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/task/step.ts apps/cli/src/commands/task/retry.ts apps/cli/test/task.test.ts
git commit -m "feat(cli): mega task step + retry (opt-in failure record, selective retry)"
```

---

## Task 16: CLI — `mega task status` + `mega task explain` + group + main.ts

**Files:**
- Create: `apps/cli/src/commands/task/{status,explain,index}.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/test/task.test.ts` (append)

- [ ] **Step 1: Append the failing test**

```ts
describe("mega task status + explain", () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cli-task3-"));
    await initStore(root);
    const r = createJsonDirectoryCoreRegistry({ rootDir: root });
    r.createProject({ id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS });
    let i = 0;
    const ids = [PLAN_ID, "d0000000-0000-4000-8000-00000000000a", "d0000000-0000-4000-8000-00000000000b"];
    r.createTaskPlan(
      PROJECT_ID,
      {
        task: "fix login",
        sessionId: null,
        steps: [
          { type: "edit", title: "edit", key: "a" },
          { type: "test", title: "test", key: "b", dependsOnKeys: ["a"] },
        ],
      },
      { now: () => TS, newId: () => ids[i++] ?? `x${i}` },
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("status prints plan status + ready steps", async () => {
    const out: string[] = [];
    const code = await runTaskStatus({ ...base(root, out, []), planIdFlag: PLAN_ID });
    expect(code).toBe(0);
    const joined = out.join("\n");
    expect(joined).toContain("status  planned");
    expect(joined).toContain("ready");
  });

  it("status --save-summary refuses when the plan is not completed", async () => {
    const err: string[] = [];
    const code = await runTaskStatus({
      ...base(root, [], err),
      planIdFlag: PLAN_ID,
      saveSummaryFlag: "all done",
    });
    expect(code).toBe(1);
    expect(err.join("\n").toLowerCase()).toContain("not completed");
  });

  it("explain renders a blocked-reason line for a dependent step", async () => {
    const out: string[] = [];
    const code = await runTaskExplain({ ...base(root, out, []), planIdFlag: PLAN_ID });
    expect(code).toBe(0);
    const joined = out.join("\n");
    expect(joined).toContain("ready"); // step a is ready
    expect(joined.toLowerCase()).toContain("blocked: waiting on"); // step b blocked on a
  });
});
```

(Add `import { runTaskExplain } from "../src/commands/task/explain.js";` to the test file's import block.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test task`
Expected: FAIL — `status.js` / `explain.js` missing.

- [ ] **Step 3a: `task/status.ts`**

```ts
import { type MemoryEntry, memoryEntrySchema, readySteps } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { formatPlanStatus, taskPlanIdSchema } from "./shared.js";

export type RunTaskStatusInput = {
  planIdFlag: string;
  saveSummaryFlag?: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  newId?: () => string;
  now?: () => string;
};

export async function runTaskStatus(input: RunTaskStatusInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let planId: ReturnType<typeof taskPlanIdSchema.parse>;
  try {
    planId = taskPlanIdSchema.parse(input.planIdFlag);
  } catch {
    input.stderr(`error: invalid task plan id "${input.planIdFlag}"`);
    return 1;
  }
  try {
    const { registry } = await ensureStoreReady(rootDir);
    const plan = registry.getTaskPlan(planId);
    if (!plan) {
      input.stderr("error: task plan not found");
      return 1;
    }
    const ready = readySteps(plan.steps);

    // Opt-in Phase 1 reuse: save a summary memory ONLY when the plan completed.
    if (input.saveSummaryFlag !== undefined) {
      if (plan.status !== "completed") {
        input.stderr("error: plan not completed; cannot save summary");
        return 1;
      }
      const newId = input.newId ?? (() => crypto.randomUUID());
      const now = input.now ?? (() => new Date().toISOString());
      const ts = readTestEnv("MEGA_TEST_NOW") ?? now();
      const entry: MemoryEntry = memoryEntrySchema.parse({
        id: readTestEnv("MEGA_TEST_MEMORY_ENTRY_ID") ?? newId(),
        projectId: plan.projectId,
        sessionId: null,
        scope: "project",
        type: "decision",
        title: `Completed task: ${plan.task}`.slice(0, 59),
        content: input.saveSummaryFlag,
        keywords: [],
        confidence: "medium",
        source: "session_summary",
        stale: false,
        createdAt: ts,
        updatedAt: ts,
      });
      registry.createMemoryEntry(entry);
      input.stderr(`note: saved summary memory ${entry.id}`);
    }

    if (input.json) {
      input.stdout(JSON.stringify({ plan, ready }));
    } else {
      for (const line of formatPlanStatus(plan, ready)) input.stdout(line);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const taskStatusCommand = defineCommand({
  meta: { name: "status", description: "Show a task plan's status and ready steps." },
  args: {
    planId: { type: "positional", required: true, description: "Task plan id (UUID)." },
    "save-summary": {
      type: "string",
      description: "Save a summary memory (only when the plan is completed).",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runTaskStatus({
      planIdFlag: typeof args.planId === "string" ? args.planId : "",
      saveSummaryFlag: typeof args["save-summary"] === "string" ? (args["save-summary"] as string) : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 3b: `task/explain.ts`** — `runTaskExplain(input)`: resolve store, parse `planId`, `getTaskPlan` (null → `error: task plan not found`, return 1). Print the task, then per step a line with type/status/dependsOn and a blocked-reason: for a `pending` step, "ready" if all deps completed else `blocked: waiting on <depId> (<depStatus>)`; for terminal steps, the status. Close with the retry-rule reminder line. Pure formatting over `getTaskPlan` + `readySteps`; mirror `status.ts` resolution + the `fail/show.ts` read shape. `defineCommand` `taskExplainCommand` with a `planId` positional + `store`/`json`.

```ts
import { readySteps } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { taskPlanIdSchema } from "./shared.js";

export type RunTaskExplainInput = {
  planIdFlag: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

export async function runTaskExplain(input: RunTaskExplainInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let planId: ReturnType<typeof taskPlanIdSchema.parse>;
  try {
    planId = taskPlanIdSchema.parse(input.planIdFlag);
  } catch {
    input.stderr(`error: invalid task plan id "${input.planIdFlag}"`);
    return 1;
  }
  try {
    const { registry } = await ensureStoreReady(rootDir);
    const plan = registry.getTaskPlan(planId);
    if (!plan) {
      input.stderr("error: task plan not found");
      return 1;
    }
    const ready = new Set(readySteps(plan.steps));
    const lines: string[] = [`task: ${plan.task} [${plan.status}]`];
    for (const step of plan.steps) {
      let note: string;
      if (step.status !== "pending") {
        note = step.status;
      } else if (ready.has(step.id)) {
        note = "ready";
      } else {
        const blocker = step.dependsOn.find(
          (dep) => plan.steps.find((s) => s.id === dep)?.status !== "completed",
        );
        const blockerStatus = plan.steps.find((s) => s.id === blocker)?.status ?? "unknown";
        note = `blocked: waiting on ${blocker} (${blockerStatus})`;
      }
      lines.push(`  ${step.type}  ${step.title}  [${step.id}]  -> ${note}`);
    }
    lines.push("retry rule: retrying a failed step resets only it and its dependents.");
    if (input.json) input.stdout(JSON.stringify({ plan, ready: [...ready] }));
    else for (const line of lines) input.stdout(line);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const taskExplainCommand = defineCommand({
  meta: { name: "explain", description: "Explain a task plan: per-step state and blocked reasons." },
  args: {
    planId: { type: "positional", required: true, description: "Task plan id (UUID)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runTaskExplain({
      planIdFlag: typeof args.planId === "string" ? args.planId : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 3c: `task/index.ts`**

```ts
import { defineCommand } from "citty";
import { taskExplainCommand } from "./explain.js";
import { taskPlanCommand } from "./plan.js";
import { taskRetryCommand } from "./retry.js";
import { taskStatusCommand } from "./status.js";
import { taskStepCommand } from "./step.js";

export { type RunTaskPlanInput, runTaskPlan, taskPlanCommand } from "./plan.js";
export { type RunTaskStepInput, runTaskStep, taskStepCommand } from "./step.js";
export { type RunTaskRetryInput, runTaskRetry, taskRetryCommand } from "./retry.js";
export { type RunTaskStatusInput, runTaskStatus, taskStatusCommand } from "./status.js";
export { type RunTaskExplainInput, runTaskExplain, taskExplainCommand } from "./explain.js";

export const taskCommand = defineCommand({
  meta: { name: "task", description: "Decompose a task into a tracked, retryable plan." },
  subCommands: {
    plan: taskPlanCommand,
    status: taskStatusCommand,
    step: taskStepCommand,
    retry: taskRetryCommand,
    explain: taskExplainCommand,
  },
});
```

- [ ] **Step 3d: Register in `main.ts`** — `import { taskCommand } from "./commands/task/index.js";` and add `task: taskCommand,` to `subCommands`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/cli test task`
Expected: PASS (all task tests across Tasks 14–16).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/task/status.ts apps/cli/src/commands/task/explain.ts apps/cli/src/commands/task/index.ts apps/cli/src/main.ts apps/cli/test/task.test.ts
git commit -m "feat(cli): mega task status/explain + register task group"
```

---

## Task 17: Full gate + changeset

**Files:**
- Create: `.changeset/phase6-task-engine.md`

- [ ] **Step 1: Lint the new files**

Run: `pnpm lint:fix` (= `biome check --write`), then inspect `git diff --stat` to confirm only Phase 6 files were reformatted.

- [ ] **Step 2: Run the CI-equivalent gate**

Run: `pnpm verify`
Expected: lint (`biome check .`) clean, typecheck clean, all tests pass, conventions ok. If a per-package step fails only on an unresolved `@megasaver/*` import, build that dep (`pnpm --filter @megasaver/core build`, `pnpm --filter @megasaver/shared build`) and re-run.

- [ ] **Step 3: Confirm the 22-tool surface end-to-end**

Run: `pnpm --filter @megasaver/mcp-bridge test server.e2e -t "lists 22 tools"`
Expected: PASS.

- [ ] **Step 4: Confirm the selective-retry headline behaviour**

Run: `pnpm --filter @megasaver/core test registry-task -t "retryTaskStep resets the failed step"`
Expected: PASS (in-memory + json).

- [ ] **Step 5: Write the changeset** (`.changeset/phase6-task-engine.md`)

```md
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
```

(Match the existing `.changeset/` file format if it differs.)

- [ ] **Step 6: Commit**

```bash
git add .changeset/phase6-task-engine.md
git commit -m "chore: changeset for Phase 6 Task Engine"
```

- [ ] **Step 7: Push + PR (when ready)**

```bash
git push -u origin feat/phase6-task-engine
```

Open a PR titled `feat: Phase 6 — Task Engine (18 → 22 tools)` against `main`, linking the spec.

---

## Self-Review Notes

- **Spec coverage:** §3b ids→T1, §6 error codes→T2, §3 entities/input→T3, §4 transitions→T4, §5 store→T5, §5 registry→T6, barrel→T7, §7 tools→T8/T9/T10/T11 + wiring T12 + e2e T13, §8 CLI→T14/T15/T16, §11 testing→tests in every task, changeset/gate→T17. Every spec section maps to a task.
- **Type/name consistency:** registry methods (`createTaskPlan`/`getTaskPlan`/`listTaskPlans`/`recordTaskStep`/`retryTaskStep`) identical across interface, both impls, MCP, CLI. Pure fns (`rollUpPlanStatus`/`applyStepOutcome`/`resetFailedStep`/`readySteps`) and types (`TaskPlan`/`TaskStep`/`TaskPlanInput`/`TaskStepInput`/`StepOutcome`/`TaskPlanStatus`/`TaskStepStatus`/`TaskStepType`) consistent between definition and consumers. Handler names (`handleBuildTaskPlan`/`handleGetTaskStatus`/`handleRecordTaskStep`/`handleRetryFailedStep`) match tool file, server import, tests. Step id constants `STEP_A`/`STEP_B` and plan id `PLAN_ID` consistent across core, mcp, cli tests.
- **State-tracker not executor:** no `task run`; `recordTaskStep` only mutates the plan; Phase 5/1 writes are opt-in and happen in handler/CLI *after* the registry call returns (outside any lock).
- **Atomicity (json impl):** `createTaskPlan`/`recordTaskStep`/`retryTaskStep` do store reads/writes inline under one `withDirLock`; the shared pure helpers (`buildTaskPlanFromInput`/`applyTaskStepRecord`/`applyTaskStepRetry`) are store-agnostic and never take a lock — flagged in T6. Opt-in `createFailedAttempt`/`createMemoryEntry` take their own lock, in the handler/CLI.
- **Selective retry:** `resetFailedStep` resets target + transitive dependents (the roadmap "debug step" is a dependent via `dependsOn`), leaves unrelated completed steps untouched; guarded by `task_step_not_failed`; cycle-safe via visited-set. Verified by core T4 + registry T6 + e2e T13 + CLI T15 tests.
- **Mint-order caveat** called out inline in T6 (plan id minted before step ids, matching the `clockFrom([planId, stepA, stepB])` test fixture) and in T8/T13 (server `newId` sequence).
- **`readySteps` import hygiene** flagged in T6 Step 3d: import it only where consumed (MCP `get_task_status`, CLI `status`/`explain`) to avoid an unused-import biome failure in `registry.ts`.
- **No placeholders:** every code step is complete and runnable; the only prose-described leaf is `task/explain.ts` Step 3b, which is then given in full immediately after the description.
