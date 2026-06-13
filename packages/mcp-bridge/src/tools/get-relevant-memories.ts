import { type CoreRegistry, CoreRegistryError, type MemoryEntry } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type GetRelevantMemoriesEnv = { registry: CoreRegistry };

const getRelevantMemoriesInputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().min(1),
    limit: z.number().int().positive().optional(),
  })
  .strict();

export type GetRelevantMemoriesResult = { memory: readonly MemoryEntry[] };

// Free-text task → top-N relevant memories. BM25 over the task string against
// title+content+keywords (same offline ranker as `mega memory search`).
export async function handleGetRelevantMemories(
  env: GetRelevantMemoriesEnv,
  rawArgs: unknown,
): Promise<GetRelevantMemoriesResult> {
  const parsed = getRelevantMemoriesInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { projectId, task, limit } = parsed.data;

  try {
    const memory = env.registry.searchMemoryEntries(projectId as ProjectId, {
      text: task,
      ...(limit !== undefined ? { limit } : {}),
    });
    return { memory };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
