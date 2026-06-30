import {
  type CoreRegistry,
  CoreRegistryError,
  type EmbedFn,
  type MemoryIndexBuildResult,
  buildMemoryIndex,
} from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

// embedFn is injectable so the boundary can be unit-tested with a fake — no model
// in CI. storeRoot locates the per-project memory-vector sidecar this build writes.
export type IndexMemoryEnv = {
  registry: CoreRegistry;
  storeRoot: string;
  embedFn?: EmbedFn;
};

const indexMemoryInputSchema = z.object({ projectId: z.string().min(1) }).strict();

// On-demand refresh of a project's memory-vector sidecar (the MCP analog of
// `mega memory index`). Heavy: loads the embedding model on the real path, so
// it is an explicit agent action, never run on a memory write. Best-effort —
// embedMemoryEntries writes the sidecar atomically, so a partial failure never
// corrupts the store; errors surface to the caller.
export async function handleIndexMemory(
  env: IndexMemoryEnv,
  rawArgs: unknown,
): Promise<MemoryIndexBuildResult> {
  const parsed = indexMemoryInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const projectId = parsed.data.projectId as ProjectId;

  try {
    const entries = env.registry.listMemoryEntries(projectId);
    return env.embedFn
      ? await buildMemoryIndex(env.storeRoot, projectId, entries, env.embedFn)
      : await buildMemoryIndex(env.storeRoot, projectId, entries);
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
