import {
  type CoreRegistry,
  CoreRegistryError,
  type MemoryEntry,
  type MemorySearchQuery,
  memoryConfidenceSchema,
  memoryScopeSchema,
  memoryTypeSchema,
} from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type SearchMemoryEnv = { registry: CoreRegistry };

const searchMemoryInputSchema = z
  .object({
    projectId: z.string().min(1),
    text: z.string().optional(),
    type: memoryTypeSchema.optional(),
    confidence: memoryConfidenceSchema.optional(),
    scope: memoryScopeSchema.optional(),
    includeStale: z.boolean().optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

export type SearchMemoryResult = { memory: readonly MemoryEntry[] };

export async function handleSearchMemory(
  env: SearchMemoryEnv,
  rawArgs: unknown,
): Promise<SearchMemoryResult> {
  const parsed = searchMemoryInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const d = parsed.data;
  // Explicit assembly (not spread): exactOptionalPropertyTypes forbids passing
  // `undefined`-valued optionals through to MemorySearchQuery's `?:` fields.
  const query: MemorySearchQuery = {
    ...(d.text !== undefined ? { text: d.text } : {}),
    ...(d.type !== undefined ? { type: d.type } : {}),
    ...(d.confidence !== undefined ? { confidence: d.confidence } : {}),
    ...(d.scope !== undefined ? { scope: d.scope } : {}),
    ...(d.includeStale !== undefined ? { includeStale: d.includeStale } : {}),
    ...(d.limit !== undefined ? { limit: d.limit } : {}),
  };

  try {
    const projectId = d.projectId;
    const memory = env.registry.searchMemoryEntries(projectId as ProjectId, query);
    return { memory };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
