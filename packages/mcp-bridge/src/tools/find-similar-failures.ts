import { type CoreRegistry, CoreRegistryError, type FailedAttempt } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type FindSimilarFailuresEnv = {
  registry: CoreRegistry;
  now: () => string;
  isPro: boolean;
};

const FREE_WINDOW_MS = 7 * 86_400_000;

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
    let failures = env.registry.searchFailedAttempts(projectId as ProjectId, {
      text: task,
      ...(limit !== undefined ? { limit } : {}),
      ...(includeConverted !== undefined ? { includeConverted } : {}),
    });
    // Free tier sees the last 7 days only — the SAME cap check_approach applies,
    // so neither tool bypasses the other.
    if (!env.isPro) {
      const cutoff = Date.parse(env.now()) - FREE_WINDOW_MS;
      failures = failures.filter((a) => Date.parse(a.createdAt) >= cutoff);
    }
    return { failures };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
