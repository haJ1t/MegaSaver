import { type CoreRegistry, CoreRegistryError, type FailedAttempt } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type FindSimilarFailuresEnv = { registry: CoreRegistry };

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().min(1),
    limit: z.number().int().positive().optional(),
    includeConverted: z.boolean().optional(),
  })
  .strict();

export type FindSimilarFailuresResult = { failures: readonly FailedAttempt[] };

export async function handleFindSimilarFailures(
  env: FindSimilarFailuresEnv,
  rawArgs: unknown,
): Promise<FindSimilarFailuresResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { projectId, task, limit, includeConverted } = parsed.data;
  try {
    const failures = env.registry.searchFailedAttempts(projectId as ProjectId, {
      text: task,
      ...(limit !== undefined ? { limit } : {}),
      ...(includeConverted !== undefined ? { includeConverted } : {}),
    });
    return { failures };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
