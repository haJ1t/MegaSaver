import { type CoreRegistry, CoreRegistryError, sweepMemoryTiers } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

// `now` is injectable so the boundary can be unit-tested with a pinned instant —
// it drives both the archival policy (asOf) and the demoted row's updatedAt, so a
// sweep is deterministic.
export type SweepMemoryEnv = { registry: CoreRegistry; now?: string };

export type SweepMemoryResult = { archived: number; scanned: number };

const sweepMemoryInputSchema = z.object({ projectId: z.string().min(1) }).strict();

// On-demand tier sweep (the MCP analog of `mega memory sweep`): demote aged-out /
// closed / low-value memories to the `archival` tier so they drop out of default
// recall. The ONLY mutation in the M2 tier system — lossless (sets tier, never
// deletes) and idempotent (already-archival rows are skipped by the planner).
// No background process.
export async function handleSweepMemory(
  env: SweepMemoryEnv,
  rawArgs: unknown,
): Promise<SweepMemoryResult> {
  const parsed = sweepMemoryInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const projectId = parsed.data.projectId as ProjectId;
  const now = env.now ?? new Date().toISOString();

  try {
    const entries = env.registry.listMemoryEntries(projectId);
    const { archiveIds } = sweepMemoryTiers(entries, now);
    for (const id of archiveIds) {
      env.registry.updateMemoryEntry(id, { tier: "archival", updatedAt: now });
    }
    return { archived: archiveIds.length, scanned: entries.length };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
