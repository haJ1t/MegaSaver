import {
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
    workspaceKey: z.string().min(1),
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

// F4 live-first variant: (projectId, sessionId) → (workspaceKey, liveSessionId).
// Same step body and the same duplicate-id / dependsOn-resolution invariants;
// only the plan key columns change. `.strict()` rejects a leftover projectId.
export const overlayTaskPlanSchema = z
  .object({
    id: taskPlanIdSchema,
    workspaceKey: z.string().min(1),
    liveSessionId: z.string().nullable(),
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

export type OverlayTaskPlan = z.infer<typeof overlayTaskPlanSchema>;

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
