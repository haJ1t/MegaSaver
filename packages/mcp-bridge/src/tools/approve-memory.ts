import {
  type CoreRegistry,
  CoreRegistryError,
  type MemoryApproval,
  memoryApprovalSchema,
} from "@megasaver/core";
import type { MemoryEntryId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type ApproveMemoryEnv = { registry: CoreRegistry; now: () => string };

const approveMemoryInputSchema = z
  .object({
    memoryEntryId: z.string().min(1),
    approval: memoryApprovalSchema.default("approved"),
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
  try {
    const updated = env.registry.updateMemoryEntry(memoryEntryId as MemoryEntryId, {
      approval,
      updatedAt: env.now(),
    });
    return { id: updated.id, approval: updated.approval };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "memory_entry_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
