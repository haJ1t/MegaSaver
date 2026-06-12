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
