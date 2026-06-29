import {
  type ContextPack,
  type PackAudit,
  auditPack,
  buildContextPack,
  readCoChangeLog,
} from "@megasaver/context-pruner";
import type { CoreRegistry } from "@megasaver/core";
import { embed, readVectors } from "@megasaver/embeddings";
import { embeddingsSidecarPath, readBlocks, resolveIndexPaths } from "@megasaver/indexer";
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type ContextToolEnv = { registry: CoreRegistry; storeRoot: string };

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().min(1),
    changedFiles: z.array(z.string()).optional(),
    failingTests: z.array(z.string()).optional(),
    maxTokens: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

// Best-effort embedding signal. Returns the pre-computed task + block vectors
// ONLY when an embeddings.jsonl sidecar exists for the project AND embedding the
// task succeeds. Any failure (no sidecar, model absent, embed throws) yields
// undefined so buildContextPack falls back to BM25-only. Never throws, logs
// nothing (spec §6).
async function embeddingSignalFor(
  indexPaths: ReturnType<typeof resolveIndexPaths>,
  task: string,
): Promise<{ taskVector: Float32Array; blockVectors: Map<string, Float32Array> } | undefined> {
  try {
    const blockVectors = readVectors(embeddingsSidecarPath(indexPaths));
    if (blockVectors.size === 0) return undefined;
    const [taskVector] = await embed([task]);
    if (taskVector === undefined) return undefined;
    return { taskVector, blockVectors };
  } catch {
    return undefined;
  }
}

// Shared composition for all four context tools: validate args → read the
// project's index + relevant memories → (best-effort) load embedding vectors →
// build the pack.
async function packFor(env: ContextToolEnv, rawArgs: unknown): Promise<ContextPack> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const projectId = projectIdSchema.safeParse(parsed.data.projectId);
  if (!projectId.success) {
    throw new McpBridgeError("validation_failed", `invalid projectId: ${parsed.data.projectId}`);
  }
  const project = env.registry.getProject(projectId.data);
  if (project === null) {
    throw new McpBridgeError("resource_not_found", `project not found: ${parsed.data.projectId}`);
  }

  const indexPaths = resolveIndexPaths(env.storeRoot, projectId.data);
  const blocks = readBlocks(indexPaths);
  const memories = env.registry.searchMemoryEntries(projectId.data, { text: parsed.data.task });
  const memoryFiles = memories.filter((m) => !m.stale).flatMap((m) => m.relatedFiles ?? []);
  const staleFiles = memories.filter((m) => m.stale).flatMap((m) => m.relatedFiles ?? []);
  const embedding = await embeddingSignalFor(indexPaths, parsed.data.task);

  return buildContextPack({
    task: parsed.data.task,
    blocks,
    changedFiles: parsed.data.changedFiles ?? [],
    failingTests: parsed.data.failingTests ?? [],
    memoryFiles,
    staleFiles,
    coChangeLog: readCoChangeLog(project.rootPath),
    ...(embedding !== undefined
      ? { taskVector: embedding.taskVector, blockVectors: embedding.blockVectors }
      : {}),
    ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
    ...(parsed.data.maxTokens !== undefined ? { maxTokens: parsed.data.maxTokens } : {}),
  });
}

export async function handleGetRelevantContext(
  env: ContextToolEnv,
  args: unknown,
): Promise<ContextPack> {
  return packFor(env, args);
}

export async function handleGetRelevantCodeBlocks(env: ContextToolEnv, args: unknown) {
  return (await packFor(env, args)).included;
}

export async function handleExplainContextSelection(env: ContextToolEnv, args: unknown) {
  return (await packFor(env, args)).included.map((block) => ({
    blockId: block.blockId,
    reasons: block.reasons,
    factors: block.factors,
  }));
}

export async function handleGetContextBudgetReport(
  env: ContextToolEnv,
  args: unknown,
): Promise<PackAudit> {
  return auditPack(await packFor(env, args));
}
