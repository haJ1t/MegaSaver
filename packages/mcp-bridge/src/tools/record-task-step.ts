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
