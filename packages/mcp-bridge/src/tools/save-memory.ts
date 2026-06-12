import {
  type CoreRegistry,
  type MemoryEntry,
  memoryApprovalSchema,
  memoryConfidenceSchema,
  memoryEntrySchema,
  memoryScopeSchema,
  memorySourceSchema,
  memoryTypeSchema,
} from "@megasaver/core";
import { CoreRegistryError } from "@megasaver/core";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type SaveMemoryEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
};

const saveMemoryInputSchema = z
  .object({
    projectId: z.string().min(1),
    scope: memoryScopeSchema,
    content: z.string().min(1),
    type: memoryTypeSchema.optional(),
    title: z.string().min(1).optional(),
    keywords: z.array(z.string()).optional(),
    confidence: memoryConfidenceSchema.optional(),
    source: memorySourceSchema.optional(),
    approval: memoryApprovalSchema.optional(),
    sessionId: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    goal: z.string().min(1).optional(),
    relatedFiles: z.array(z.string()).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

// CoreRegistry failures carry a closed code; surface it as the matching wire
// code so an MCP client sees why the write was rejected.
function mapCoreError(err: unknown): McpBridgeError {
  if (err instanceof CoreRegistryError) {
    if (err.code === "session_not_found") {
      return new McpBridgeError("session_not_found", err.message);
    }
    if (err.code === "project_not_found") {
      return new McpBridgeError("resource_not_found", err.message);
    }
    return new McpBridgeError("validation_failed", err.message);
  }
  if (err instanceof Error) return new McpBridgeError("validation_failed", err.message);
  return new McpBridgeError("validation_failed", "save_memory failed");
}

export async function handleSaveMemory(
  env: SaveMemoryEnv,
  rawArgs: unknown,
): Promise<{ id: string }> {
  const parsed = saveMemoryInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const d = parsed.data;

  let entry: MemoryEntry;
  try {
    entry = memoryEntrySchema.parse({
      id: env.newId(),
      projectId: d.projectId,
      sessionId: d.sessionId ?? null,
      scope: d.scope,
      type: d.type ?? "todo",
      title: d.title ?? d.content,
      content: d.content,
      keywords: d.keywords ?? [],
      confidence: d.confidence ?? "medium",
      source: d.source ?? "agent",
      approval: d.approval ?? "suggested",
      ...(d.reason !== undefined ? { reason: d.reason } : {}),
      ...(d.goal !== undefined ? { goal: d.goal } : {}),
      ...(d.relatedFiles !== undefined ? { relatedFiles: d.relatedFiles } : {}),
      ...(d.expiresAt !== undefined ? { expiresAt: d.expiresAt } : {}),
      createdAt: env.now(),
      updatedAt: env.now(),
    });
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "invalid memory entry",
    );
  }

  try {
    const created = env.registry.createMemoryEntry(entry);
    return { id: created.id };
  } catch (err) {
    throw mapCoreError(err);
  }
}
