import { type ContextPack, buildImpactPack } from "@megasaver/context-pruner";
import type { CoreRegistry } from "@megasaver/core";
import { readBlocks, resolveIndexPaths } from "@megasaver/indexer";
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type ImpactToolEnv = { registry: CoreRegistry; storeRoot: string };

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    symbol: z.string().min(1),
    maxTokens: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

// Reverse call-graph blast radius: given a symbol, return the symbol plus every
// transitive caller (who breaks if you change it). Reads the project index and
// walks calledBy under the pruner budget. Unknown symbol → empty pack, no throw.
export function handleImpact(env: ImpactToolEnv, rawArgs: unknown): ContextPack {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const projectId = projectIdSchema.safeParse(parsed.data.projectId);
  if (!projectId.success) {
    throw new McpBridgeError("validation_failed", `invalid projectId: ${parsed.data.projectId}`);
  }
  if (env.registry.getProject(projectId.data) === null) {
    throw new McpBridgeError("resource_not_found", `project not found: ${parsed.data.projectId}`);
  }

  const blocks = readBlocks(resolveIndexPaths(env.storeRoot, projectId.data));
  return buildImpactPack({
    symbol: parsed.data.symbol,
    blocks,
    ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
    ...(parsed.data.maxTokens !== undefined ? { maxTokens: parsed.data.maxTokens } : {}),
  });
}
