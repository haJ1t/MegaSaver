import type { CoreRegistry, MemoryApproval } from "@megasaver/core";
import type { MemoryEntryId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type ApproveMemoryEnv = { registry: CoreRegistry; now: () => string };

// `suggested` is deliberately NOT an accepted input: a memory cannot be moved
// back into the unapproved state via this tool — that is not an approval
// decision, and allowing it would let an agent reverse an approved memory out
// of the gate. approve_memory represents a HUMAN approval decision relayed
// through the agent; an autonomous agent self-approving its own
// save_memory(suggested) defeats the gate — by convention this is a
// human-in-the-loop action.
const approveMemoryInputSchema = z
  .object({
    memoryEntryId: z.string().min(1),
    approval: z.enum(["approved", "rejected"]).default("approved"),
  })
  .strict();

export type ApproveMemoryResult = { id: string; approval: MemoryApproval };

export async function handleApproveMemory(
  env: ApproveMemoryEnv,
  rawArgs: unknown,
): Promise<ApproveMemoryResult> {
  const parsed = approveMemoryInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { memoryEntryId, approval } = parsed.data;
  const id = memoryEntryId as MemoryEntryId;

  const existing = env.registry.getMemoryEntry(id);
  if (existing === null) {
    throw new McpBridgeError("resource_not_found", `memory entry not found: ${memoryEntryId}`);
  }
  // True no-op: re-approving an already-approved memory must not churn updatedAt.
  if (existing.approval === approval) {
    return { id: existing.id, approval: existing.approval };
  }

  const updated = env.registry.updateMemoryEntry(id, { approval, updatedAt: env.now() });
  return { id: updated.id, approval: updated.approval };
}
