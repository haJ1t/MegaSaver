import {
  type ContextPack,
  type PackAudit,
  auditPack,
  buildContextPack,
  readCoChangeLog,
} from "@megasaver/context-pruner";
import type { CoreRegistry } from "@megasaver/core";
import { readBlocks, resolveIndexPaths } from "@megasaver/indexer";
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

// Shared composition for all four context tools: validate args → read the
// project's index + relevant memories → build the pack.
function packFor(env: ContextToolEnv, rawArgs: unknown): ContextPack {
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

  const blocks = readBlocks(resolveIndexPaths(env.storeRoot, projectId.data));
  const memories = env.registry.searchMemoryEntries(projectId.data, { text: parsed.data.task });
  const memoryFiles = memories.filter((m) => !m.stale).flatMap((m) => m.relatedFiles ?? []);
  const staleFiles = memories.filter((m) => m.stale).flatMap((m) => m.relatedFiles ?? []);

  return buildContextPack({
    task: parsed.data.task,
    blocks,
    changedFiles: parsed.data.changedFiles ?? [],
    failingTests: parsed.data.failingTests ?? [],
    memoryFiles,
    staleFiles,
    coChangeLog: readCoChangeLog(project.rootPath),
    ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
    ...(parsed.data.maxTokens !== undefined ? { maxTokens: parsed.data.maxTokens } : {}),
  });
}

export function handleGetRelevantContext(env: ContextToolEnv, args: unknown): ContextPack {
  return packFor(env, args);
}

export function handleGetRelevantCodeBlocks(env: ContextToolEnv, args: unknown) {
  return packFor(env, args).included;
}

export function handleExplainContextSelection(env: ContextToolEnv, args: unknown) {
  return packFor(env, args).included.map((block) => ({
    blockId: block.blockId,
    reasons: block.reasons,
    factors: block.factors,
  }));
}

export function handleGetContextBudgetReport(env: ContextToolEnv, args: unknown): PackAudit {
  return auditPack(packFor(env, args));
}
