import {
  type ContextPack,
  type PackAudit,
  auditPack,
  buildContextPack,
  readCoChangeLog,
} from "@megasaver/context-pruner";
import {
  type CoreRegistry,
  approvedMemoryFiles,
  staleMemoryFiles,
  taskScopedMemoryFiles,
} from "@megasaver/core";
import { embed, readVectors } from "@megasaver/embeddings";
import { embeddingsSidecarPath, readBlocks, resolveIndexPaths } from "@megasaver/indexer";
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

// embedFn is injectable so the boundary can be unit-tested with a fake — no model
// in CI. Production omits it (the real lazy embed() is used).
export type EmbedFn = (texts: readonly string[]) => Promise<Float32Array[]>;
export type ContextToolEnv = { registry: CoreRegistry; storeRoot: string; embedFn?: EmbedFn };

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
  embedFn: EmbedFn,
): Promise<{ taskVector: Float32Array; blockVectors: Map<string, Float32Array> } | undefined> {
  try {
    const blockVectors = readVectors(embeddingsSidecarPath(indexPaths));
    if (blockVectors.size === 0) return undefined;
    const [taskVector] = await embedFn([task]);
    if (taskVector === undefined) return undefined;
    return { taskVector, blockVectors };
  } catch {
    return undefined;
  }
}

// Shared composition for all four context tools: validate args → read the
// project's index + relevant memories → (best-effort) load embedding vectors →
// build the pack.
export async function packFor(env: ContextToolEnv, rawArgs: unknown): Promise<ContextPack> {
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
  const embedFn = env.embedFn ?? embed;
  const memories = env.registry.listMemoryEntries(projectId.data);
  const embedding = await embeddingSignalFor(indexPaths, parsed.data.task, embedFn);
  // Task-scope the memoryRelevance feed when a memory sidecar + a task vector are
  // available: rank approved memories by cosine to the task and feed only the
  // task-relevant ones' relatedFiles. Reuse the task vector the code-block signal
  // already computed so we never embed the task twice. Best-effort — null on
  // no-sidecar / no task vector / any failure, falling back to ALL approved
  // memory's relatedFiles (today's recall-safe behavior; never regresses).
  const scopedFiles = await taskScopedMemoryFiles({
    storeRoot: env.storeRoot,
    projectId: projectId.data,
    memories,
    task: parsed.data.task,
    embedFn,
    ...(embedding !== undefined ? { taskVector: embedding.taskVector } : {}),
  });
  const memoryFiles = scopedFiles ?? approvedMemoryFiles(memories);
  const staleFiles = staleMemoryFiles(memories);

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
