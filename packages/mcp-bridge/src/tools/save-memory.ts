import {
  type CoreRegistry,
  type MemoryEntry,
  type SaveMemoryLineageResult,
  memoryApprovalSchema,
  memoryConfidenceSchema,
  memoryEmbedText,
  memoryEmbeddingsSidecarPath,
  memoryEntrySchema,
  memoryScopeSchema,
  memorySourceSchema,
  memoryTypeSchema,
  saveMemoryWithLineage,
} from "@megasaver/core";
import { CoreRegistryError } from "@megasaver/core";
import { embed, readVectors } from "@megasaver/embeddings";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type SaveMemoryEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
  // Cosine supersession inputs are best-effort: storeRoot locates the memory
  // vector sidecar; embedFn is injectable so tests never load the real model.
  storeRoot?: string;
  embedFn?: (texts: readonly string[]) => Promise<Float32Array[]>;
};

export type SaveMemoryResult = {
  id: string;
  supersession?: SaveMemoryLineageResult["supersession"];
  deduped?: SaveMemoryLineageResult["deduped"];
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
    supersedesId: z.string().min(1).optional(),
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

// Best-effort cosine inputs for supersession detection (living brain §4.2):
// only when a storeRoot is configured AND the sidecar has vectors. Embeds the
// candidate's title+content once. Any failure (no model, unreadable sidecar)
// degrades to lexical-only detection — never blocks the save.
async function cosineInputsFor(
  env: SaveMemoryEnv,
  entry: MemoryEntry,
): Promise<{ queryVector: Float32Array; memoryVectors: Map<string, Float32Array> } | undefined> {
  if (env.storeRoot === undefined) return undefined;
  try {
    const memoryVectors = readVectors(
      memoryEmbeddingsSidecarPath(env.storeRoot, entry.projectId as ProjectId),
    );
    if (memoryVectors.size === 0) return undefined;
    const [queryVector] = await (env.embedFn ?? embed)([memoryEmbedText(entry)]);
    if (queryVector === undefined) return undefined;
    return { queryVector, memoryVectors };
  } catch {
    return undefined;
  }
}

export async function handleSaveMemory(
  env: SaveMemoryEnv,
  rawArgs: unknown,
): Promise<SaveMemoryResult> {
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
      ...(d.supersedesId !== undefined ? { supersedesId: d.supersedesId } : {}),
      createdAt: env.now(),
      updatedAt: env.now(),
    });
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "invalid memory entry",
    );
  }

  const cosineInputs = await cosineInputsFor(env, entry);
  try {
    const result = saveMemoryWithLineage(env.registry, entry, {
      now: env.now,
      ...(cosineInputs ?? {}),
    });
    return {
      id: result.entry.id,
      ...(result.supersession !== undefined ? { supersession: result.supersession } : {}),
      ...(result.deduped !== undefined ? { deduped: result.deduped } : {}),
    };
  } catch (err) {
    throw mapCoreError(err);
  }
}
