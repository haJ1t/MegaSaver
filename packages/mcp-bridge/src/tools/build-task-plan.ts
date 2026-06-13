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
