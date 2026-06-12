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
    throw new McpBridgeError(
      "resource_not_found",
      `Task plan does not exist: ${parsed.data.planId}`,
    );
  }
  return { plan, ready: readySteps(plan.steps) };
}
